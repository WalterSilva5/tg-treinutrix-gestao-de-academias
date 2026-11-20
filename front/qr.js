/* Gerador de QR Code (byte mode, correção M) — sem dependências.
   Implementação própria, validada com decodificador. Uso:
     var qr = QR.qrMatrix('http://192.168.0.10:3001');
     qr.size, qr.modules[r][c] (1 = escuro)
   Base: especificação ISO/IEC 18004. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  // [blocos, totalPorBloco, dadosPorBloco, ...] para nível M, versões 1..10
  var RS_M = {
    1: [1, 26, 16], 2: [1, 44, 28], 3: [1, 70, 44], 4: [2, 50, 32], 5: [2, 67, 43],
    6: [4, 43, 27], 7: [4, 49, 31], 8: [2, 60, 38, 2, 61, 39],
    9: [3, 58, 36, 2, 59, 37], 10: [4, 69, 43, 1, 70, 44],
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  function totalDataCodewords(version) {
    var spec = RS_M[version], total = 0;
    for (var i = 0; i < spec.length; i += 3) total += spec[i] * spec[i + 2];
    return total;
  }

  function rsGenPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = new Uint8Array(data.length + ecLen);
    res.set(data);
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef === 0) continue;
      for (var j = 1; j < gen.length; j++) res[i + j] ^= mul(gen[j], coef);
    }
    return Array.prototype.slice.call(res, data.length);
  }

  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }

  function buildData(text, version) {
    var bytes = utf8(text);
    var cap = totalDataCodewords(version) * 8;
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    put(4, 4); // byte mode
    put(bytes.length, version < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);
    if (bits.length > cap) throw new Error('conteúdo grande demais para o QR');
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
      data.push(v);
    }
    var pad = 0xec;
    while (data.length < totalDataCodewords(version)) { data.push(pad); pad = pad === 0xec ? 0x11 : 0xec; }
    return data;
  }

  function buildCodewords(data, version) {
    var spec = RS_M[version], blocks = [], offset = 0;
    for (var i = 0; i < spec.length; i += 3) {
      var count = spec[i], total = spec[i + 1], dlen = spec[i + 2];
      for (var b = 0; b < count; b++) {
        var chunk = data.slice(offset, offset + dlen);
        offset += dlen;
        blocks.push({ data: chunk, ec: rsEncode(chunk, total - dlen) });
      }
    }
    var out = [], maxData = 0, maxEc = 0;
    blocks.forEach(function (b) { maxData = Math.max(maxData, b.data.length); maxEc = Math.max(maxEc, b.ec.length); });
    for (var d = 0; d < maxData; d++) blocks.forEach(function (b) { if (d < b.data.length) out.push(b.data[d]); });
    for (var e = 0; e < maxEc; e++) blocks.forEach(function (b) { if (e < b.ec.length) out.push(b.ec[e]); });
    return out;
  }

  function bchDigit(v) { var n = 0; while (v !== 0) { n++; v >>>= 1; } return n; }
  function formatBits(mask) {
    var data = (0 << 3) | mask; // nível M = 00
    var d = data << 10;
    while (bchDigit(d) - bchDigit(0x537) >= 0) d ^= 0x537 << (bchDigit(d) - bchDigit(0x537));
    return ((data << 10) | d) ^ 0x5412;
  }
  function versionBits(version) {
    var d = version << 12;
    while (bchDigit(d) - bchDigit(0x1f25) >= 0) d ^= 0x1f25 << (bchDigit(d) - bchDigit(0x1f25));
    return (version << 12) | d;
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0; },
  ];

  function baseMatrix(version) {
    var size = version * 4 + 17;
    var mod = [], fn = [];
    for (var r = 0; r < size; r++) { mod.push(new Array(size).fill(0)); fn.push(new Array(size).fill(false)); }

    function finder(row, col) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        mod[rr][cc] = dark ? 1 : 0; fn[rr][cc] = true;
      }
    }
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

    for (var i = 8; i < size - 8; i++) {
      if (!fn[6][i]) { mod[6][i] = i % 2 === 0 ? 1 : 0; fn[6][i] = true; }
      if (!fn[i][6]) { mod[i][6] = i % 2 === 0 ? 1 : 0; fn[i][6] = true; }
    }

    var centers = ALIGN[version];
    for (var a = 0; a < centers.length; a++) for (var b = 0; b < centers.length; b++) {
      var ar = centers[a], ac = centers[b];
      if (fn[ar][ac]) continue;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
        var dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        mod[ar + dr][ac + dc] = dark ? 1 : 0; fn[ar + dr][ac + dc] = true;
      }
    }

    // módulo fixo escuro
    mod[size - 8][8] = 1; fn[size - 8][8] = true;

    // reserva áreas de formato e versão
    for (var k = 0; k < 9; k++) {
      if (!fn[8][k]) { fn[8][k] = true; }
      if (!fn[k][8]) { fn[k][8] = true; }
    }
    for (var k2 = 0; k2 < 8; k2++) {
      fn[8][size - 1 - k2] = true;
      fn[size - 1 - k2][8] = true;
    }
    if (version >= 7) {
      for (var v1 = 0; v1 < 6; v1++) for (var v2 = 0; v2 < 3; v2++) {
        fn[size - 11 + v2][v1] = true;
        fn[v1][size - 11 + v2] = true;
      }
    }
    return { size: size, mod: mod, fn: fn };
  }

  function placeData(base, codewords) {
    var size = base.size, mod = base.mod, fn = base.fn;
    var bitIndex = 0, byteIndex = 0, inc = -1, row = size - 1;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          if (!fn[row][col - c]) {
            var dark = 0;
            if (byteIndex < codewords.length) dark = (codewords[byteIndex] >>> (7 - bitIndex)) & 1;
            mod[row][col - c] = dark;
            bitIndex++;
            if (bitIndex === 8) { bitIndex = 0; byteIndex++; }
          }
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }
  }

  function applyMask(base, maskIndex) {
    var size = base.size, mod = base.mod, fn = base.fn, fnMask = MASKS[maskIndex];
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      if (!fn[r][c] && fnMask(r, c)) mod[r][c] ^= 1;
    }
  }

  function penalty(mod, size) {
    var score = 0, r, c, i;
    for (r = 0; r < size; r++) {
      var runColor = mod[r][0], runLen = 1;
      for (c = 1; c < size; c++) {
        if (mod[r][c] === runColor) runLen++;
        else { if (runLen >= 5) score += 3 + (runLen - 5); runColor = mod[r][c]; runLen = 1; }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }
    for (c = 0; c < size; c++) {
      var rc = mod[0][c], rl = 1;
      for (r = 1; r < size; r++) {
        if (mod[r][c] === rc) rl++;
        else { if (rl >= 5) score += 3 + (rl - 5); rc = mod[r][c]; rl = 1; }
      }
      if (rl >= 5) score += 3 + (rl - 5);
    }
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      var v = mod[r][c];
      if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) score += 3;
    }
    var patterns = [[1,0,1,1,1,0,1,0,0,0,0], [0,0,0,0,1,0,1,1,1,0,1]];
    function hasPattern(get) {
      for (var s = 0; s <= size - 11; s++) {
        for (var p = 0; p < 2; p++) {
          var ok = true;
          for (i = 0; i < 11; i++) if (get(s + i) !== patterns[p][i]) { ok = false; break; }
          if (ok) return true;
        }
      }
      return false;
    }
    for (r = 0; r < size; r++) if (hasPattern(function (idx) { return mod[r][idx]; })) score += 40;
    for (c = 0; c < size; c++) if (hasPattern(function (idx) { return mod[idx][c]; })) score += 40;
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += mod[r][c];
    var pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function writeFormat(mod, size, mask) {
    var bits = formatBits(mask);
    for (var i = 0; i < 15; i++) {
      var bit = (bits >> i) & 1;
      if (i < 6) mod[i][8] = bit;
      else if (i < 8) mod[i + 1][8] = bit;
      else mod[size - 15 + i][8] = bit;

      if (i < 8) mod[8][size - i - 1] = bit;
      else if (i < 9) mod[8][15 - i] = bit;
      else mod[8][15 - i - 1] = bit;
    }
    mod[size - 8][8] = 1;
  }

  function writeVersion(mod, size, version) {
    if (version < 7) return;
    var bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var bit = (bits >> i) & 1;
      mod[Math.floor(i / 3)][(i % 3) + size - 11] = bit;
      mod[(i % 3) + size - 11][Math.floor(i / 3)] = bit;
    }
  }

  function qrMatrix(text, forcedMask) {
    var version = 0;
    for (var v = 1; v <= 10; v++) {
      var needed = 4 + (v < 10 ? 8 : 16) + utf8(text).length * 8;
      if (needed <= totalDataCodewords(v) * 8) { version = v; break; }
    }
    if (!version) throw new Error('conteúdo grande demais para o QR');
    var data = buildData(text, version);
    var codewords = buildCodewords(data, version);
    var best = null, bestScore = Infinity;
    var masks = typeof forcedMask === 'number' ? [forcedMask] : [0, 1, 2, 3, 4, 5, 6, 7];
    for (var mi = 0; mi < masks.length; mi++) {
      var mask = masks[mi];
      var base = baseMatrix(version);
      placeData(base, codewords);
      applyMask(base, mask);
      writeFormat(base.mod, base.size, mask);
      writeVersion(base.mod, base.size, version);
      var score = penalty(base.mod, base.size);
      if (score < bestScore) { bestScore = score; best = { size: base.size, mod: base.mod, mask: mask }; }
    }
    return { size: best.size, version: version, mask: best.mask, modules: best.mod };
  }

  return { qrMatrix: qrMatrix };
});
