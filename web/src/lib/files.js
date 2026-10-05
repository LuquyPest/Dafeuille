/* Fichiers générés côté navigateur : téléchargement et PDF (jsPDF chargé à la demande, empaqueté avec l'app). */

export async function saveFile(filename, data, mime){
  const blob = data instanceof Blob ? data : new Blob([data], {type:mime});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

const pdfTxt = s => String(s ?? "").replace(/[  ]/g, " ").replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, "-")
  .replace(/[^\x20-\x7E -ÿ€]/gu, "").trim();

/** Document A4 : titre, puis blocs {h} titre, {kv:[[k,v]]}, {p} paragraphe, {table:{head, rows, widths, align}} */
export async function buildPdf(title, blocks){
  const {jsPDF} = await import("jspdf");
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const W = 210, M = 16, maxY = 280; let y = 20;
  const need = h => { if (y + h > maxY) { doc.addPage(); y = 20; } };
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text(pdfTxt(title), M, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110);
  doc.text(pdfTxt("DAFeuille · édité le " + new Date().toLocaleDateString("fr-FR")), M, y + 3); doc.setTextColor(0); y += 10;
  for (const b of blocks) {
    if (b.h) { need(14); y += 4; doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(pdfTxt(b.h), M, y); y += 6; doc.setFont("helvetica", "normal"); }
    if (b.kv) { doc.setFontSize(10); for (const [k, v] of b.kv) { need(6); doc.text(pdfTxt(k), M, y); doc.text(pdfTxt(v), W - M, y, {align:"right"}); y += 5.5; } }
    if (b.p) { doc.setFontSize(10); for (const line of doc.splitTextToSize(pdfTxt(b.p), W - 2 * M)) { need(6); doc.text(line, M, y); y += 5; } }
    if (b.table) {
      const {head, rows, widths, align = []} = b.table; doc.setFontSize(9);
      const tw = W - 2 * M, ws = widths.map(w => w * tw);
      const drawRow = (cells, bold) => {
        const wrapped = cells.map((c, i) => doc.splitTextToSize(pdfTxt(c), ws[i] - 2));
        const h = Math.max(...wrapped.map(w => w.length)) * 4.2 + 2;
        need(h + 1);
        doc.setFont("helvetica", bold ? "bold" : "normal");
        let x = M;
        wrapped.forEach((w, i) => { const r = align[i] === "r"; doc.text(w, r ? x + ws[i] - 1 : x + 1, y, {align:r ? "right" : "left"}); x += ws[i]; });
        y += h - 2; doc.setDrawColor(220); doc.line(M, y - 0.5, W - M, y - 0.5); y += 2;
      };
      drawRow(head, true);
      rows.forEach(r => drawRow(r, r.bold));
    }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.text(`${i} / ${n}`, W - M, 290, {align:"right"}); }
  return doc;
}
export const savePdf = async (filename, title, blocks) => saveFile(filename, (await buildPdf(title, blocks)).output("blob"), "application/pdf");
