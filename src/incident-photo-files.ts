export const photoBucket = 'incident-photos'
export const photoMaxBytes = 5_000_000
export const photoTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
export const photoAccept = photoTypes.join(',')

export async function validateIncidentPhoto(file: Blob) {
  if (!file.size) throw new Error('The photo is empty. Choose another file.')
  if (file.size > photoMaxBytes) throw new Error('Choose a photo that is 5 MB or smaller.')
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const matches = (bytes: number[], start = 0) => bytes.every((byte, index) => header[start + index] === byte)
  let mime: (typeof photoTypes)[number] | undefined
  if (matches([255, 216, 255])) mime = 'image/jpeg'
  if (matches([137, 80, 78, 71, 13, 10, 26, 10])) mime = 'image/png'
  if (matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8)) mime = 'image/webp'
  if (!mime || (file.type && file.type !== mime)) {
    throw new Error('Choose a JPEG, PNG or WebP photo. If your photo is HEIC, convert it to JPEG first.')
  }
  return mime
}
