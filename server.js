const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ✅ ADD FIREBASE ADMIN INITIALIZATION
let db;
try {
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    console.log('⚠️ Firebase environment variables not found - Firestore disabled');
  } else {
    const adminApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    db = getFirestore(adminApp);
    console.log('✅ Firebase Admin initialized successfully');
  }
} catch (firebaseError) {
  console.error('❌ Firebase Admin initialization failed:', firebaseError.message);
}

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

// ✅ NEW: Function to save extracted data to Firestore
async function saveToFirestore(sessionId, userId, extractedData, filename) {
  if (!db) {
    console.log('⚠️ Firestore not available - skipping database save');
    return false;
  }

  try {
    await db.collection('tickets').doc(sessionId).set({
      status: 'extracted',
      processingStatus: 'completed',
      extractedData: extractedData,
      extractedAt: new Date(),
      userId: userId,
      fileName: filename,
      sessionId: sessionId,
      createdAt: new Date()
    }, { merge: true });
    console.log('✅ Extracted data saved to Firestore for session:', sessionId);
    return true;
  } catch (error) {
    console.error('❌ Error saving to Firestore:', error);
    return false;
  }
}

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// MULTI-IMAGE DATA EXTRACTION ENDPOINT - UPDATED
app.post('/extract-data', upload.array('images', 5), async (req, res) => {
  const startTime = Date.now();
  
  // ✅ GET SESSION DATA FROM REQUEST BODY
  const { sessionId, userId, dataSource = 'desktop_upload' } = req.body;
  
  console.log('🔄 Processing extraction request:', { 
    sessionId, 
    userId, 
    files: req.files?.length || 0,
    dataSource 
  });

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
          const jsonMatch = aiResponse.match(/```json\n([\s\S]*?)\n```/) || 
                          aiResponse.match(/```([\s\S]*?)```/) ||
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

        // ✅ NEW: SAVE TO FIRESTORE AFTER SUCCESSFUL EXTRACTION
        if (sessionId && userId) {
          const saveSuccess = await saveToFirestore(sessionId, userId, extractedData, file.originalname);
          if (saveSuccess) {
            console.log('✅ Data saved to Firestore for user:', userId);
          }
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
        imageInfo,
        savedToFirestore: !!(sessionId && userId)
      });
    }

    const processingTime = Date.now() - startTime;
    
    res.json({
      success: true,
      processingTime,
      imagesProcessed: results.length,
      sessionId,
      userId,
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

// ✅ NEW ENDPOINT FOR MOBILE UPLOADS (IMAGE URLS)
app.post('/extract-data-from-url', async (req, res) => {
  const startTime = Date.now();
  
  const { imageUrl, sessionId, userId, dataSource = 'mobile_upload' } = req.body;
  
  console.log('🔄 Processing extraction from URL:', { 
    sessionId, 
    userId, 
    imageUrl: imageUrl ? 'URL provided' : 'No URL'
  });

  try {
    if (!imageUrl) {
      return res.status(400).json({ error: 'No image URL provided' });
    }

    // Download image from URL
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');

    // Use your existing OpenAI extraction logic
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
    let extractedData = {};
    let analysis = "";

    // Parse JSON from response (same as your existing code)
    try {
      const jsonMatch = aiResponse.match(/```json\n([\s\S]*?)\n```/) || 
                      aiResponse.match(/```([\s\S]*?)```/) ||
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

    // Save to Firestore
    if (sessionId && userId) {
      const saveSuccess = await saveToFirestore(sessionId, userId, extractedData, 'mobile_upload');
      if (saveSuccess) {
        console.log('✅ Data saved to Firestore for user:', userId);
      }
    }

    const processingTime = Date.now() - startTime;
    
    res.json({
      success: true,
      processingTime,
      sessionId,
      userId,
      results: [{
        filename: 'from_url',
        extractedData,
        analysis,
        imageInfo: { size: 'Unknown', type: 'from_url', dimensions: 'Unknown' },
        savedToFirestore: !!(sessionId && userId)
      }]
    });

  } catch (error) {
    console.error('Error processing image from URL:', error);
    res.status(500).json({
      error: 'Failed to process image from URL',
      details: error.message
    });
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!fs.existsSync('.env')) {
    console.log('⚠️  .env file not found. Please create one with:');
    console.log('OPENAI_API_KEY=your_openai_api_key_here');
  }
});