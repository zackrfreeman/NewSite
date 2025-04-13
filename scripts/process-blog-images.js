// process-blog-images.js

const sharp = require('sharp');
const fs = require('fs').promises; // Using promises version for async/await
const path = require('path');

// --- Configuration ---
// --- Configuration ---
const inputDir = path.join(__dirname, '..', 'src/assets/images/blog'); // Go up one level from scripts folder
const outputDir = path.join(__dirname, '..', 'public/assets/images/blog'); // Go up one level from scripts folder
// ... rest of config ...
const maxWidth = 800; // Resize images to max width (height auto-scales)
const quality = 80; // Compression quality (0-100) for webp/jpeg
// --------------------

// Function to process a single image
async function processImage(inputFile, outputFile) {
  try {
    const image = sharp(inputFile);
    // Get metadata to check if resizing is needed
    const metadata = await image.metadata();

    console.log(`Processing: ${path.basename(inputFile)}`);

    // Example: Resize if wider than maxWidth, convert to WebP and JPEG with quality
    let processedImage = image;
    if (metadata.width > maxWidth) {
      processedImage = processedImage.resize({ width: maxWidth });
      console.log(` -> Resized to ${maxWidth}px wide`);
    } else {
      console.log(` -> No resize needed (width ${metadata.width}px <= ${maxWidth}px)`);
    }

    // Create WebP version
    const webpPath = outputFile.replace(/\.\w+$/, '.webp'); // Change extension
    await processedImage
      .webp({ quality: quality })
      .toFile(webpPath);
    console.log(` -> Saved WebP (${quality}% quality) to ${path.basename(webpPath)}`);

    // Optional: Create JPEG version (useful for fallback)
    // const jpegPath = outputFile.replace(/\.\w+$/, '.jpeg'); // Change extension
    // await processedImage
    //   .jpeg({ quality: quality })
    //   .toFile(jpegPath);
    // console.log(` -> Saved JPEG (${quality}% quality) to ${path.basename(jpegPath)}`);

    // Optional: Create PNG version (if source is PNG and you want compressed PNG)
    // if (metadata.format === 'png') {
    //     const pngPath = outputFile.replace(/\.\w+$/, '.png'); // Ensure extension is png
    //     await processedImage
    //         .png({ quality: quality }) // Sharp's PNG quality is complex, experiment
    //         .toFile(pngPath);
    //     console.log(` -> Saved PNG (${quality}% quality) to ${path.basename(pngPath)}`);
    // }


  } catch (err) {
    console.error(`Error processing ${path.basename(inputFile)}:`, err);
  }
}

// Main function to run the process
async function run() {
  console.log(`Starting image processing...`);
  console.log(`Input directory: ${inputDir}`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`Max Width: ${maxWidth}px`);
  console.log(`Quality: ${quality}`);
  console.log('---');

  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    console.log('Output directory created or already exists.');

    // Read files from input directory
    const files = await fs.readdir(inputDir);
    console.log(`Found ${files.length} files in input directory.`);

    // Process each file
    for (const file of files) {
      const inputFile = path.join(inputDir, file);
      const outputFile = path.join(outputDir, file); // Base output path

      // Basic check for image files (you might want more robust checking)
      if (/\.(jpg|jpeg|png|gif|webp|avif|tiff)$/i.test(file)) {
        await processImage(inputFile, outputFile);
      } else {
        console.log(`Skipping non-image file: ${file}`);
      }
    }

    console.log('---');
    console.log('Image processing complete.');

  } catch (err) {
    console.error('Error reading input directory or creating output directory:', err);
  }
}

// Execute the main function
run();