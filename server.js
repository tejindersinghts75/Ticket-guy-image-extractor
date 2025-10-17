const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3000;


// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});


// Configure multer for multiple file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});


const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit per file
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});


// Middleware
app.use(express.static('.'));
app.use(express.json());


// Helper function to convert image to base64
function encodeImageToBase64(imagePath) {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
}


// Helper function to get image info
function getImageInfo(filePath, originalname) {
    const stats = fs.statSync(filePath);
    const ext = path.extname(originalname).toLowerCase();


    return {
        size: `${(stats.size / 1024).toFixed(2)} KB`,
        type: ext,
        dimensions: 'Unknown'
    };
}


// Main route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// MULTI-IMAGE DATA EXTRACTION ENDPOINT
app.post('/extract-data', upload.array('images', 5), async (req, res) => {
    const startTime = Date.now();
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No image files uploaded' });
        }


        // Array to hold results for each image
        const results = [];


        for (const file of req.files) {
            let extractedData = {};
            let analysis = "";
            let imageInfo = getImageInfo(file.path, file.originalname);
            try {
                const imageBase64 = encodeImageToBase64(file.path);


                // Prepare prompt for structured data extraction
                const systemPrompt = `You are an expert data extraction AI. Your job is to analyze images and extract structured data from them.


                Please extract all readable text and data from the image and format it as a JSON object with consistent field names. 


                For documents like forms, tickets, receipts, or any structured document, please organize the data logically with clear field names.


                Common fields to look for and standardize:
                - Names: firstname, middlename, lastname, fullname
                - Dates: date, issuedate, duedate, birthdate
                - Addresses: address, street, city, state, zipcode
                - IDs: id, ticketno, licenseno, caseno
                - Amounts: amount, fine, fee, total
                - Vehicle info: make, model, year, color, plate, vin
                - Locations: location, intersection, zone
                - Times: time, datetime
                - Other relevant fields based on document type


                Always return valid JSON with meaningful field names. If a field is not present, omit it from the JSON rather than including null values.


                Also provide a brief analysis of what type of document this appears to be and what information was extracted.`;


                const userPrompt = `Please analyze this image and extract all structured data from it. Return the data in a clean JSON format with consistent field names, and provide a brief analysis of the document type.`;


                // Make API call to OpenAI
                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt
                        },
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: userPrompt
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/jpeg;base64,${imageBase64}`,
                                        detail: "high"
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 1500,
                    temperature: 0.1
                });


                const aiResponse = response.choices[0].message.content;


                // Try to parse JSON from the response
                try {
                    // Look for JSON in the response
                    const jsonMatch = aiResponse.match(/``````/) || 
                                    aiResponse.match(/``````/) ||
                                    aiResponse.match(/\{[\s\S]*\}/);


                    if (jsonMatch) {
                        const jsonString = jsonMatch[1] || jsonMatch[0];
                        extractedData = JSON.parse(jsonString);
                        analysis = aiResponse.replace(jsonMatch[0], '').trim();
                        if (!analysis) analysis = "Data successfully extracted from the image.";
                    } else {
                        try {
                            extractedData = JSON.parse(aiResponse);
                            analysis = "Data successfully extracted and parsed.";
                        } catch (e) {
                            extractedData = { rawText: aiResponse };
                            analysis = "Could not parse structured data, raw text provided.";
                        }
                    }
                } catch (parseError) {
                    extractedData = { error: "Could not parse structured data", rawResponse: aiResponse };
                    analysis = "The AI provided a response but it could not be parsed as structured JSON.";
                }
            } catch (imgErr) {
                extractedData = { error: "Image extraction failed", details: imgErr.message };
                analysis = "";
            } finally {
                try { fs.unlinkSync(file.path); } catch(e){}
            }
            results.push({
                filename: file.originalname,
                extractedData,
                analysis,
                imageInfo
            });
        }


        const processingTime = Date.now() - startTime;
        res.json({
            success: true,
            processingTime,
            imagesProcessed: results.length,
            results
        });


    } catch (error) {
        console.error('Error processing images:', error);
        res.status(500).json({
            error: 'Failed to process images',
            details: error.message
        });
        // Cleanup all files
        if (req.files && Array.isArray(req.files)) {
            for (const file of req.files) {
                try { fs.unlinkSync(file.path); } catch(e){}
            }
        }
    }
});


// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
        }
    }
    res.status(500).json({ error: error.message });
});


// // Start server
// app.listen(PORT, () => {
//     console.log(`🚀 Server running on http://localhost:${PORT}`);
//     console.log('📁 Make sure to create a .env file with your OPENAI_API_KEY');
//     if (!fs.existsSync('.env')) {
//         console.log('⚠️  .env file not found. Please create one with:');
//         console.log('OPENAI_API_KEY=your_openai_api_key_here');
//     }
// });



// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    // Optional: for local testing only
    // console.log('📁 Make sure to create a .env file with your OPENAI_API_KEY');
    if (!fs.existsSync('.env')) {
        console.log('⚠️  .env file not found. Please create one with:');
        console.log('OPENAI_API_KEY=your_openai_api_key_here');
    }
});