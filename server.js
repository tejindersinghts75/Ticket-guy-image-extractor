const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ✅ SIMPLE MODE SWITCH - Change this value
const MODE = 'prod'; // Change to 'prod' for real AI extraction

// ✅ MOCK DATA EXTRACTION FUNCTION
// ✅ MOCK DATA EXTRACTION FUNCTION
// ✅ MOCK DATA EXTRACTION FUNCTION - UPDATED TO MATCH NEW STRUCTURE
function mockDataExtraction() {
  console.log('🔄 Using MOCK DATA for extraction');

  // Return data in the SAME STRUCTURE the AI will return
  return {
    ticket_header: {
      County: "Bexar",
      Precinct: "3",
      Citation_Number: "MOCK" + Math.random().toString().slice(2, 8),
      Issue_Date_and_Time: "09/19/2025 at 07:58 AM",
      Violation_Date_and_Time: "09/19/2025 at 07:58 AM"
    },
    
    violator_information: {
      LAST_NAME: "DOE",
      FIRST: "JOHN",
      MIDDLE: "", // ✅ Missing - will trigger form
      RESIDENCE_ADDRESS: "123 MAIN ST",
      PHONE: "", // ✅ Missing - will trigger form
      TY: "SAN ANTONIO",
      STATE: "TX",
      ZIP_CODE: "78201",
      INTER_LICENSE_NUMBER: "DL123456",
      DL_CLASS: "C",
      DL_STATE: "TX",
      CDL: "No",
      DATE_OF_BIRTH: "01/01/1980",
      SEX: "M",
      RACE: "H",
      HEIGHT: "510",
      WEIGHT: "180",
      EYE_COLOR: "BRO",
      HAIR_COLOR: "BRO"
    },
    
    additional_information_business: {
      PARENT_EMPLOYER: "",
      ADDRESS: "",
      PHONE: "",
      CITY: "",
      STATE: "",
      ZIP_CODE: ""
    },
    
    vehicle_information: {
      LICENSE_PLATE: "MOCK123",
      STATE: "TX",
      REG_EXP: "0126",
      COLOR: "BLUE",
      MAKE: "HONDA",
      MODEL: "CIVIC",
      TYPE: "",
      VIN: "1HGCM82633A123456",
      YEAR: "2022",
      C_W: "No",
      MAXIAT: "No",
      TRAILER_PLATE: "",
      TRAILER_STATE: "",
      DOT_NUMBER: "",
      TOWED: "No"
    },
    
    location_information: {
      ADDRESS: "1400 E BORGFELD DR",
      DIRECTION_OF_TRAVEL: "",
      DIRECTION_OF_TURN: ""
    },
    
    violation: {
      CITATION: "Speeding in School Zone",
      ALLEGED_SPEED_MPH: "44",
      POSTED_SPEED_MPH: "30",
      CASE_NO: "",
      CONSTR_ZONE_WORKERS_PRESENT: "No",
      SCHOOL_ZONE: "Yes",
      ACCIDENT: "No",
      KNEWRACE: "No",
      SEARCH: "No Search",
      CONTRABAND: "",
      ADDITIONAL_NOTES: "ATTENDED AND UNABLE TO VERIFY FINANCIAL RESPONSIBILITY"
    },
    
    // ✅ THESE ARE MISSING TO TRIGGER THE FORM:
    email: "", // Will be provided by user
    is_jp: "", // Missing - will trigger form
    precinct_number: "" // Missing but not required unless JP=Y
  };
}

// ✅ FIX: Remove dotenv or make it optional
try {
  require('dotenv').config();
  console.log('✅ .env file loaded (local development)');
} catch (e) {
  console.log('ℹ️  No .env file found, using environment variables (production)');
}

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
// ✅ ADD DEBUG LOGGING TO CHECK ENV VARS
console.log('🔑 Environment Variables Check:');
console.log('OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
console.log('FIREBASE_PROJECT_ID exists:', !!process.env.FIREBASE_PROJECT_ID);
console.log('FIREBASE_CLIENT_EMAIL exists:', !!process.env.FIREBASE_CLIENT_EMAIL);
console.log('FIREBASE_PRIVATE_KEY exists:', !!process.env.FIREBASE_PRIVATE_KEY);
console.log('🔄 CURRENT MODE:', MODE);

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

// ✅ ✅ ✅ ADD THIS NEW FUNCTION RIGHT HERE ✅ ✅ ✅
function checkMissingFields(extractedData, userEmail) {
  const requiredFields = [
    'email',
    'first_name', 
    'middle_name', 
    'last_name',
    'infraction_violation', 
    'phone_number',
    'county',
    'is_jp'
  ];

  const missingFields = [];

  requiredFields.forEach(field => {
    if (field === 'email') {
      if (!userEmail || userEmail.trim() === '') {
        missingFields.push('email');
      }
    }
    else if (field === 'first_name') {
      if (!extractedData.violator_information?.FIRST || extractedData.violator_information.FIRST.trim() === '') {
        missingFields.push('first_name');
      }
    }
    else if (field === 'middle_name') {
      if (!extractedData.violator_information?.MIDDLE || extractedData.violator_information.MIDDLE.trim() === '') {
        missingFields.push('middle_name');
      }
    }
    else if (field === 'last_name') {
      if (!extractedData.violator_information?.LAST_NAME || extractedData.violator_information.LAST_NAME.trim() === '') {
        missingFields.push('last_name');
      }
    }
    else if (field === 'infraction_violation') {
      if (!extractedData.violation?.CITATION || extractedData.violation.CITATION.trim() === '') {
        missingFields.push('infraction_violation');
      }
    }
    else if (field === 'phone_number') {
      if (!extractedData.violator_information?.PHONE || extractedData.violator_information.PHONE.trim() === '') {
        missingFields.push('phone_number');
      }
    }
    else if (field === 'county') {
      if (!extractedData.ticket_header?.County || extractedData.ticket_header.County.trim() === '') {
        missingFields.push('county');
      }
    }
    else if (!extractedData[field] || extractedData[field].toString().trim() === '') {
      missingFields.push(field);
    }
  });

  // Special check: If JP=Y, precinct is required
  const isJp = extractedData.is_jp || "";
  if (isJp === 'Y' && (!extractedData.precinct_number || extractedData.precinct_number.trim() === '')) {
    missingFields.push('precinct_number');
  }

  return missingFields;
}
// ✅ ✅ ✅ END OF NEW FUNCTION ✅ ✅ ✅
// ✅ ✅ ✅ ADD THIS NEW FUNCTION RIGHT HERE ✅ ✅ ✅
function removeUndefinedValues(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = typeof value === 'object' ? removeUndefinedValues(value) : value;
    }
  }
  return cleaned;
}
// ✅ ✅ ✅ END OF NEW FUNCTION ✅ ✅ ✅

// ✅ ENHANCED: Function to save extracted data to Firestore WITH DASHBOARD FIELDS
async function saveToFirestore(sessionId, userId, extractedData, filename, email, dataSource = 'ai_extraction') {
  if (!db) {
    console.log('⚠️ Firestore not available - skipping database save');
    return false;
  }

  try {
    // ✅ STATUS MESSAGES FOR DASHBOARD (CLIENTS SEE THESE)
    const statusMessages = {
      approval_pending: "We need more information before approving your case. You will receive a call or email requesting additional information. If you have already been contacted by our team, please upload the requested documents below.",
      case_approved: "Congratulations! Your case is approved. You'll receive an email when the status of your case changes or if we need any communications from you.",
      case_in_progress: "Your case is in progress. If you have not received any calls or emails from us, it means our legal team is working on your case. You'll receive an email when the status of your case changes.",
      case_dismissed: "Congratulations. Our legal team has won your case. No further action is needed unless our legal team contacts you.",
      case_appealed: "Your case has been appealed. Our legal team is working on the next steps. You'll receive updates via email.",
      case_requires_attention: "Your case requires additional attention. Our team will contact you shortly with more information."
    };

    // ✅ DIFFERENT STATUS BASED ON DATA SOURCE
    let status, statusNote;

    if (dataSource === 'manual_form') {
      status = 'completed';
      statusNote = 'Manual form submitted with complete information';
    } else {
      status = 'extracted';
      statusNote = 'Ticket uploaded and AI extraction completed';
    }

    // ✅ CREATE/UPDATE TICKET WITH DASHBOARD FIELDS
    await db.collection('tickets').doc(sessionId).set({
      // Your existing fields:
      status: status, // ✅ Now dynamic
      processingStatus: 'completed',
      extractedData: extractedData,
      extractedAt: new Date(),
      userId: userId,
      email: email,
      fileName: filename,
      sessionId: sessionId,
      createdAt: new Date(),
      dataSource: dataSource, // ✅ Track the source

      // ✅ NEW DASHBOARD FIELDS:
      caseStatus: 'approval_pending', // Default starting status
      statusHistory: [{
        status: 'approval_pending',
        timestamp: new Date(),
        updatedBy: 'system',
        notes: statusNote // ✅ Correct note for each type
      }],
      clientMessages: statusMessages,
      requiredDocuments: [], // For upload functionality
      lastUpdated: new Date()
    }, { merge: true });

    console.log('✅ Ticket with dashboard fields saved to Firestore:', sessionId);

    // ✅ AUDIT LOG
    await db.collection('audit-logs').add({
      action: 'ticket_created_with_dashboard',
      timestamp: new Date(),
      sessionId: sessionId,
      userId: userId,
      email: email,
      dataSource: dataSource, // ✅ Include data source
      status: 'success'
    });

    return true;
  } catch (error) {
    console.error('❌ Error saving to Firestore:', error);

    // Error audit log
    await db.collection('audit-logs').add({
      action: 'ticket_creation_failed',
      timestamp: new Date(),
      sessionId: sessionId,
      error: error.message,
      dataSource: dataSource,
      status: 'failed'
    });

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

  const { sessionId, userId, dataSource = 'desktop_upload' } = req.body;

  // ADD THIS STATUS CHECK BEFORE PROCESSING FILES
  if (sessionId && db) {
    const existingTicket = await db.collection('tickets').doc(sessionId).get();
    if (existingTicket.exists && existingTicket.data().status === 'completed') {
      return res.status(400).json({
        error: 'Ticket already completed',
        isCompleted: true,
        message: 'This ticket has already been processed. Please start a new session.'
      });
    }
  }

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
    let firstExtractedData = null; // ✅ ADD THIS

    for (const file of req.files) {
      let extractedData = {};
      let analysis = "";
      let imageInfo = getImageInfo(file.path, file.originalname);

      try {
        const imageBase64 = encodeImageToBase64(file.path);

        // ✅ SIMPLE SWITCH: TEST vs PROD
        if (MODE === 'test') {
          // USE MOCK DATA
          console.log('🔄 Using MOCK DATA for extraction (TEST mode)');
          extractedData = mockDataExtraction();
          analysis = "Mock data generated for testing - MODE: test";
        } else {
          // USE REAL OPENAI API
          console.log('🔄 Using REAL OpenAI API (PROD mode)');

          // Prepare prompt for structured data extraction

          const systemPrompt = `You are an expert data extraction system for Texas traffic violation tickets. Extract EVERY FIELD from the ticket image and organize it into this EXACT JSON structure:

{
  "ticket_header": {
    "County": "[County name]",
    "Precinct": "[Precinct number]", 
    "Citation_Number": "[Citation number]",
    "Issue_Date_and_Time": "[Issue date and time]",
    "Violation_Date_and_Time": "[Violation date and time]"
  },
  
  "violator_information": {
    "LAST_NAME": "[Last name]",
    "FIRST": "[First name]",
    "MIDDLE": "[Middle name]",
    "RESIDENCE_ADDRESS": "[Street address]",
    "PHONE": "[Phone number or empty]",
    "TY": "[City]", 
    "STATE": "[State]",
    "ZIP_CODE": "[ZIP code]",
    "INTER_LICENSE_NUMBER": "[Driver license number]",
    "DL_CLASS": "[License class]",
    "DL_STATE": "[License state]",
    "CDL": "[Yes/No]",
    "DATE_OF_BIRTH": "[Date of birth]",
    "SEX": "[M/F]",
    "RACE": "[Race code]", 
    "HEIGHT": "[Height in inches]",
    "WEIGHT": "[Weight in lbs]",
    "EYE_COLOR": "[Eye color]",
    "HAIR_COLOR": "[Hair color]"
  },
  
  "additional_information_business": {
    "PARENT_EMPLOYER": "[Usually 'PARENT / EMPLOYER' or empty]",
    "ADDRESS": "[Address or empty]",
    "PHONE": "[Phone or empty]",
    "CITY": "[City or empty]",
    "STATE": "[State or empty]",
    "ZIP_CODE": "[ZIP or empty]"
  },
  
  "vehicle_information": {
    "LICENSE_PLATE": "[License plate]",
    "STATE": "[State]",
    "REG_EXP": "[Registration expiration]",
    "COLOR": "[Vehicle color]",
    "MAKE": "[Make]",
    "MODEL": "[Model]",
    "TYPE": "[Vehicle type or empty]",
    "VIN": "[VIN number]",
    "YEAR": "[Year]",
    "C_W": "[Yes/No]",
    "MAXIAT": "[Yes/No]",
    "TRAILER_PLATE": "[Trailer plate or empty]",
    "TRAILER_STATE": "[Trailer state or empty]",
    "DOT_NUMBER": "[DOT number or empty]",
    "TOWED": "[Yes/No]"
  },
  
  "location_information": {
    "ADDRESS": "[Violation location address]",
    "DIRECTION_OF_TRAVEL": "[Direction or empty]",
    "DIRECTION_OF_TURN": "[Direction or empty]"
  },
  
  "violation": {
    "CITATION": "[Violation description]",
    "ALLEGED_SPEED_MPH": "[Speed]",
    "POSTED_SPEED_MPH": "[Speed limit]",
    "CASE_NO": "[Case number or empty]",
    "CONSTR_ZONE_WORKERS_PRESENT": "[Yes/No]",
    "SCHOOL_ZONE": "[Yes/No]",
    "ACCIDENT": "[Yes/No]",
    "KNEWRACE": "[Yes/No]",
    "SEARCH": "[Search details]",
    "CONTRABAND": "[Contraband or empty]",
    "ADDITIONAL_NOTES": "[Any additional text]"
  }
}

CRITICAL RULES:
1. Use EXACTLY these field names (case-sensitive)
2. All fields MUST be included even if empty
3. Map data from ticket to matching fields
4. Preserve original text from ticket
5. Return ONLY JSON, no explanations

Now extract all data from the traffic ticket image.`;

         const userPrompt = `Extract all data from this Texas traffic citation image and format it as JSON using the exact structure provided.`;

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
            max_tokens: 2000,
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
        }

        // ✅ STORE FIRST EXTRACTED DATA FOR MISSING FIELDS CHECK
        if (!firstExtractedData) {
          firstExtractedData = extractedData; // ✅ Store for later use
        }

        // ✅ SAVE TO FIRESTORE AFTER SUCCESSFUL EXTRACTION
        if (sessionId && userId) {
          const userEmail = req.body.email;

          const saveSuccess = await saveToFirestore(sessionId, userId, extractedData, file.originalname, userEmail, 'ai_extraction');
          if (saveSuccess) {
            console.log('✅ Data saved to Firestore for user:', userId);
          }
        }

      } catch (imgErr) {
        console.error('❌ Extraction error:', imgErr);
        extractedData = { error: "Image extraction failed", details: imgErr.message };
        analysis = "";
      } finally {
        try { fs.unlinkSync(file.path); } catch (e) { }
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

    // ✅ FIXED: Use firstExtractedData which is now defined
    res.json({
      success: true,
      processingTime,
      imagesProcessed: results.length,
      sessionId,
      userId,
      results,
      missingFields: checkMissingFields(firstExtractedData, req.body.email), // ✅ FIXED
      isComplete: checkMissingFields(firstExtractedData, req.body.email).length === 0 // ✅ FIXED
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
        try { fs.unlinkSync(file.path); } catch (e) { }
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

  // ADD THIS STATUS CHECK BEFORE PROCESSING IMAGE URL
  if (sessionId && db) {
    const existingTicket = await db.collection('tickets').doc(sessionId).get();
    if (existingTicket.exists && existingTicket.data().status === 'completed') {
      return res.status(400).json({
        error: 'Ticket already completed',
        isCompleted: true,
        message: 'This ticket has already been processed. Please start a new session.'
      });
    }
  }

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

    let extractedData = {};
    let analysis = "";

    // ✅ SIMPLE SWITCH: TEST vs PROD
    if (MODE === 'test') {
      // USE MOCK DATA
      console.log('🔄 Using MOCK DATA for URL extraction (TEST mode)');
      extractedData = mockDataExtraction();
      analysis = "Mock data generated for testing - MODE: test";
    } else {
      // USE REAL OPENAI API
      console.log('🔄 Using REAL OpenAI API for URL extraction (PROD mode)');

      // Replace the current systemPrompt with this:
  const systemPrompt = `You are an expert data extraction system for Texas traffic violation tickets. Extract EVERY FIELD from the ticket image and organize it into this EXACT JSON structure:

{
  "ticket_header": {
    "County": "[County name]",
    "Precinct": "[Precinct number]", 
    "Citation_Number": "[Citation number]",
    "Issue_Date_and_Time": "[Issue date and time]",
    "Violation_Date_and_Time": "[Violation date and time]"
  },
  
  "violator_information": {
    "LAST_NAME": "[Last name]",
    "FIRST": "[First name]",
    "MIDDLE": "[Middle name]",
    "RESIDENCE_ADDRESS": "[Street address]",
    "PHONE": "[Phone number or empty]",
    "TY": "[City]", 
    "STATE": "[State]",
    "ZIP_CODE": "[ZIP code]",
    "INTER_LICENSE_NUMBER": "[Driver license number]",
    "DL_CLASS": "[License class]",
    "DL_STATE": "[License state]",
    "CDL": "[Yes/No]",
    "DATE_OF_BIRTH": "[Date of birth]",
    "SEX": "[M/F]",
    "RACE": "[Race code]", 
    "HEIGHT": "[Height in inches]",
    "WEIGHT": "[Weight in lbs]",
    "EYE_COLOR": "[Eye color]",
    "HAIR_COLOR": "[Hair color]"
  },
  
  "additional_information_business": {
    "PARENT_EMPLOYER": "[Usually 'PARENT / EMPLOYER' or empty]",
    "ADDRESS": "[Address or empty]",
    "PHONE": "[Phone or empty]",
    "CITY": "[City or empty]",
    "STATE": "[State or empty]",
    "ZIP_CODE": "[ZIP or empty]"
  },
  
  "vehicle_information": {
    "LICENSE_PLATE": "[License plate]",
    "STATE": "[State]",
    "REG_EXP": "[Registration expiration]",
    "COLOR": "[Vehicle color]",
    "MAKE": "[Make]",
    "MODEL": "[Model]",
    "TYPE": "[Vehicle type or empty]",
    "VIN": "[VIN number]",
    "YEAR": "[Year]",
    "C_W": "[Yes/No]",
    "MAXIAT": "[Yes/No]",
    "TRAILER_PLATE": "[Trailer plate or empty]",
    "TRAILER_STATE": "[Trailer state or empty]",
    "DOT_NUMBER": "[DOT number or empty]",
    "TOWED": "[Yes/No]"
  },
  
  "location_information": {
    "ADDRESS": "[Violation location address]",
    "DIRECTION_OF_TRAVEL": "[Direction or empty]",
    "DIRECTION_OF_TURN": "[Direction or empty]"
  },
  
  "violation": {
    "CITATION": "[Violation description]",
    "ALLEGED_SPEED_MPH": "[Speed]",
    "POSTED_SPEED_MPH": "[Speed limit]",
    "CASE_NO": "[Case number or empty]",
    "CONSTR_ZONE_WORKERS_PRESENT": "[Yes/No]",
    "SCHOOL_ZONE": "[Yes/No]",
    "ACCIDENT": "[Yes/No]",
    "KNEWRACE": "[Yes/No]",
    "SEARCH": "[Search details]",
    "CONTRABAND": "[Contraband or empty]",
    "ADDITIONAL_NOTES": "[Any additional text]"
  }
}

CRITICAL RULES:
1. Use EXACTLY these field names (case-sensitive)
2. All fields MUST be included even if empty
3. Map data from ticket to matching fields
4. Preserve original text from ticket
5. Return ONLY JSON, no explanations

Now extract all data from the traffic ticket image.`;

         const userPrompt = `Extract all data from this Texas traffic citation image and format it as JSON using the exact structure provided.`;

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
    }

    // Save to Firestore
    if (sessionId && userId) {
      const userEmail = req.body.email;

      const saveSuccess = await saveToFirestore(sessionId, userId, extractedData, 'mobile_upload', userEmail, 'ai_extraction');
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
      }],
      // ✅ ADD THESE 2 NEW FIELDS:
      missingFields: checkMissingFields(extractedData, req.body.email),
      isComplete: checkMissingFields(extractedData, req.body.email).length === 0
    });

  } catch (error) {
    console.error('Error processing image from URL:', error);
    res.status(500).json({
      error: 'Failed to process image from URL',
      details: error.message
    });
  }
});

// ✅ ADD THIS NEW ENDPOINT TO YOUR BACKEND
app.post('/update-ticket', async (req, res) => {
  const { sessionId, missingFieldsData } = req.body;

  console.log('🔄 Updating ticket with missing fields:', { sessionId, missingFieldsData });

  try {
    if (!sessionId || !missingFieldsData) {
      return res.status(400).json({ error: 'Missing sessionId or missingFieldsData' });
    }
    // ✅ ADD THIS STATUS CHECK (MISSING IN YOUR CODE)
    if (sessionId && db) {
      const existingTicket = await db.collection('tickets').doc(sessionId).get();
      if (existingTicket.exists && existingTicket.data().status === 'completed') {
        return res.status(400).json({
          error: 'Ticket already completed',
          isCompleted: true,
          message: 'This ticket has already been processed. Please start a new session.'
        });
      }
    }
    // ✅ Update Firestore with Admin SDK (bypasses security rules)
    const ticketRef = db.collection('tickets').doc(sessionId);

    // Prepare update data
    const updateData = {};
    Object.keys(missingFieldsData).forEach(field => {
      updateData[`extractedData.${field}`] = missingFieldsData[field];
    });

    updateData.status = 'completed';
    updateData.completedAt = new Date();
    updateData.lastUpdated = new Date();

    await ticketRef.update(updateData);

    console.log('✅ Ticket updated successfully:', sessionId);

    res.json({
      success: true,
      message: 'Ticket updated successfully',
      sessionId: sessionId
    });

  } catch (error) {
    console.error('❌ Error updating ticket:', error);
    res.status(500).json({
      error: 'Failed to update ticket',
      details: error.message
    });
  }
});

// ✅ NEW SECURE ENDPOINT
app.get('/check-ticket/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const ticketDoc = await db.collection('tickets').doc(sessionId).get();

    if (!ticketDoc.exists) {
      return res.json({ exists: false });
    }

    const ticketData = ticketDoc.data();
    const extractedData = ticketData.extractedData || {};

    // Check missing fields (same logic as before)
    const missingFields = checkMissingFields(extractedData, ticketData.email || '');

    res.json({
      exists: true,
      status: ticketData.status,
      missingFields: missingFields,
      extractedData: extractedData,
      isComplete: missingFields.length === 0
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to check ticket' });
  }
});

// ✅ ADD MANUAL FORM SUBMISSION ENDPOINT discarted
app.post('/submit-manual-form', async (req, res) => {
  const formData = req.body;

  console.log('🔄 Processing manual form submission:', {
    email: formData.email,
    fieldsReceived: Object.keys(formData).length
  });

  try {
    if (!formData.email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // 1. CREATE SESSION (same as QR flow)
    const sessionResponse = await fetch('https://ticketguysclerk.vercel.app/api/create-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: formData.email })
    });

    const sessionData = await sessionResponse.json();
    if (!sessionData.success) {
      throw new Error(sessionData.message || 'Failed to create session');
    }

    const { sessionId, userId } = sessionData;

    // 2. PREPARE DATA (map your form fields)
    // ✅ CORRECTED FIELD MAPPING
    const firestoreData = {
      // Personal Information
      email: formData.email,
      first_name: formData.firstname,
      middle_name: formData.middlename,
      last_name: formData.lastname,
      phone_number: formData.mobileno,

      // Address
      residence_address: formData.residenceaddress,
      state: formData.state,
      city: formData.city,
      zip_code: formData.zipcodeno,

      // Driver Info
      driving_license_no: formData.drivingllicenseno,
      dl_class: formData.dlClass,
      cdl: formData.cdl,
      date_of_birth: formData.dob,
      sex: formData.sex,
      height: formData.height,
      weight: formData.weight,
      race: formData.race,
      eye_color: formData.eyeColor,
      hair_color: formData.hairColor,

      // Vehicle Info
      license_plate: formData.licenseplate,
      vehicle_state: formData.state, // Using same as state
      vehicle_regexp: formData.regexp,
      vehicle_color: formData.colorvehicle,
      vehicle_make: formData.make,
      vehicle_model: formData.model,
      vehicle_type: formData.type,
      vehicle_year: formData.carYear,
      vin: formData.vin,

      // Citation Info
      citation_number: formData.citationnumber,
      issuing_authority: formData.issuingauthority,
      issue_date_time: formData['issue-datetime'],

      citation_type: formData.citation,
      alleged_speed: formData.allegedspeed,
      posted_speed: formData.postedspeed,
      case_no: formData.caseno,

      // Violation Details
      construction_zone: formData.constrzone,
      school_zone: formData.schoolzone,
      accident: formData.accident,
      knew_race: formData.knewrace,
      search: formData.search,
      contraband: formData.contraband,

      // Officer & Court
      officer_name: formData.officername,
      officer_id: formData.officerid,
      court_information: formData.courtinformation,
      court_hours: formData.courtHours,

      // Additional Vehicle Info
      trailer_plate: formData.trailerplate,
      dot: formData.dot,
      trailer_state: formData.trailerState,
      cmv: formData.cmv,
      hazmat: formData.hazmat,
      towed: formData.towed,
      financial: formData.financial,

      // Metadata
      dataSource: 'manual_form',
      manuallyEntered: true,
      submissionDate: new Date()
    };

    // ADD THIS LINE BEFORE SAVING TO FIRESTORE
    const cleanedFirestoreData = removeUndefinedValues(firestoreData);
    const saveSuccess = await saveToFirestore(
      sessionId,
      userId,
      cleanedFirestoreData,   // Only cleanedFirestoreData goes here!
      'manual_form_complete',
      formData.email,
      'manual_form'
    );


    if (!saveSuccess) {
      throw new Error('Failed to save manual form data');
    }

    // 4. SUCCESS RESPONSE
    res.json({
      success: true,
      sessionId: sessionId,
      userId: userId,
      message: 'Manual form submitted successfully',
      status: 'completed'
    });

  } catch (error) {
    console.error('❌ Manual form submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit manual form',
      details: error.message
    });
  }
});

// ✅ NO TICKET - MANUAL INFORMATION FORM
app.post('/submit-no-ticket-form', async (req, res) => {
  const formData = req.body;

  console.log('🔄 Processing no-ticket form submission:', {
    email: formData.email,
    fieldsReceived: Object.keys(formData).length
  });

  try {
    // ✅ VALIDATE REQUIRED FIELDS
    const requiredFields = ['email', 'first_name', 'last_name', 'infraction_violation', 'phone_number', 'county', 'is_jp'];
    const missingFields = requiredFields.filter(field => !formData[field] || formData[field].toString().trim() === '');

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missingFields: missingFields
      });
    }

    // ✅ VALIDATE JP PRECINCT
    if (formData.is_jp === 'Y' && (!formData.precinct_number || formData.precinct_number.trim() === '')) {
      return res.status(400).json({
        error: 'Precinct number required for JP cases',
        missingFields: ['precinct_number']
      });
    }

    // 1. CREATE SESSION (same as other flows)
    const sessionResponse = await fetch('https://ticketguysclerk.vercel.app/api/create-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: formData.email })
    });

    const sessionData = await sessionResponse.json();
    if (!sessionData.success) {
      throw new Error(sessionData.message || 'Failed to create session');
    }

    const { sessionId, userId } = sessionData;

    // 2. PREPARE DATA FOR FIRESTORE
    const firestoreData = {
      // Personal Information (REQUIRED)
      email: formData.email,
      first_name: formData.first_name,
      middle_name: formData.middle_name || '',
      last_name: formData.last_name,
      phone_number: formData.phone_number,
      county: formData.county,
      is_jp: formData.is_jp,

      // Violation Information (REQUIRED)
      infraction_violation: formData.infraction_violation,

      // Conditional JP Precinct
      ...(formData.is_jp === 'Y' && { precinct_number: formData.precinct_number }),

      // Metadata
      dataSource: 'no_ticket_form',
      manuallyEntered: true,
      hasPhysicalTicket: false,
      submissionDate: new Date()
    };

    // 3. SAVE TO FIRESTORE
    const cleanedData = removeUndefinedValues(firestoreData);
    const saveSuccess = await saveToFirestore(
      sessionId,
      userId,
      cleanedData,
      'no_ticket_form',
      formData.email,
      'no_ticket_form'
    );

    if (!saveSuccess) {
      throw new Error('Failed to save no-ticket form data');
    }

    // 4. SUCCESS RESPONSE
    res.json({
      success: true,
      sessionId: sessionId,
      userId: userId,
      message: 'Information submitted successfully',
      status: 'completed',
      caseStatus: 'approval_pending'
    });

  } catch (error) {
    console.error('❌ No-ticket form submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit information',
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
  console.log(`🎯 CURRENT MODE: ${MODE}`);
});