/* Redimensionnement d'images côté navigateur (tickets, photos de membres). */
export async function drawScaled(file, max){
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
/** Ticket : version compressée en data URL (≈ 230 Ko max) */
export async function ticketDataUrl(file){
  let small = (await drawScaled(file, 1000)).toDataURL("image/jpeg", .6);
  if (small.length > 230000) small = (await drawScaled(file, 760)).toDataURL("image/jpeg", .5);
  return small;
}
/** Vignette carrée recadrée (photos de membres, avatars) */
export async function squareThumb(file, s = 96, q = .8){
  const bmp = await createImageBitmap(file), c = document.createElement("canvas"); c.width = s; c.height = s;
  const k = Math.max(s / bmp.width, s / bmp.height), w = bmp.width * k, h = bmp.height * k;
  c.getContext("2d").drawImage(bmp, (s - w) / 2, (s - h) / 2, w, h);
  return c.toDataURL("image/jpeg", q);
}
