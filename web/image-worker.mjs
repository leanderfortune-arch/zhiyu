import sharp from "sharp";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const options = JSON.parse(process.argv[2] || "{}");
let image = sharp(Buffer.concat(chunks), { limitInputPixels: 24_000_000 });
if (options.width)
  image = image.resize(options.width, options.height, { fit: "inside", withoutEnlargement: true });
process.stdout.write(await image.png().toBuffer());
