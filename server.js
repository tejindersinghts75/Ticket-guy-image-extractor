const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ✅ SIMPLE MODE SWITCH - Change this value
const MODE = 'test'; // Change to 'prod' for real AI extraction

// ✅ MOCK DATA EXTRACTION FUNCTION
function mockDataExtraction() {
  console.log('🔄 Using MOCK DATA for extraction');
  
   return {
    citation_number: "MOCK" + Math.random().toString().slice(2, 8),
    issue_date: new Date().toLocaleDateString('en-US'),
    
    // ✅ SOME FIELDS PRESENT (for testing)
    first_name: "JOHN",
    last_name: "DOE",
    
    // ❌ MISSING FIELDS (for testing smart form)
    // middle_name: "", // Missing - will trigger form
    // phone_number: "", // Missing - will trigger form
    // county: "", // Missing - will trigger form
    // is_jp: "", // Missing - will trigger form
    
    violation: {
      citation: "Speeding in School Zone", // ✅ Has violation
      alleged_speed: "44",
      posted_speed: "30", 
      school_zone: "Yes"
    },
    location_information: {
      location: "1400 E BORGFELD DR"
    },
    vehicle_information: {
      make: "HONDA",
      model: "CIVIC",
      year: "2022", 
      color: "BLUE",
      license_plate: "MOCK123",
      state: "TX"
    },
    violator_information: {
      driver_license_number: "DL123456",
      city: "SAN ANTONIO", 
      state: "TX"
    }
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
                  // Use the email from Clerk auth
                  if (!userEmail || userEmail.trim() === '') {
                    missingFields.push('email');
                  }
                }
                else if (field === 'infraction_violation') {
                  // Check violation citation
                  if (!extractedData.violation?.citation) {
                    missingFields.push('infraction_violation');
                  }
                }
                else if (!extractedData[field] || extractedData[field].toString().trim() === '') {
                  missingFields.push(field);
                }
              });

              // Special check: If JP=Y, precinct is required
              if (extractedData.is_jp === 'Y' && (!extractedData.precinct_number || extractedData.precinct_number.trim() === '')) {
                missingFields.push('precinct_number');
              }

              return missingFields;
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
    const missingFields = checkMissingFields(extractedData);
    
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

// ✅ ADD MANUAL FORM SUBMISSION ENDPOINT
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
    const firestoreData = {
  // Personal Information
  email: formData.email,
  first_name: formData.firstname,
  middle_name: formData.middlename,
  last_name: formData.lastname,
  phone_number: formData.mobileno,
  
  // Address
  residence_address: formData.residenceaddress,
  state: formData.stateSelect,
  city: formData.citySelect,
  zip_code: formData.zipcodeno,
  
  // Driver Info
  driving_license_no: formData.drivingllicenseno,
  dl_class: formData.dlClass,
  cdl: formData.cdl,
  date_of_birth: formData.dateofbirth,
  sex: formData.sex,
  height: formData.height,
  weight: formData.weight,
  race: formData.race,
  eye_color: formData.eyeColor,
  hair_color: formData.hairColor,
  
  // Vehicle Info
  license_plate: formData.licenseplate,
  vehicle_state: formData.vistateSelect,
  vehicle_regexp: formData.regexp, // ✅ ADDED MISSING FIELD
  vehicle_color: formData.colorvehicle,
  vehicle_make: formData.make,
  vehicle_model: formData.model,
  vehicle_type: formData.type,
  vehicle_year: formData.carYear,
  vin: formData.vin,
  
  // Citation Info
  citation_number: formData.citationnumber,
  issuing_authority: formData.issuingauthority,
  issue_date_time: formData.issuedatetime,
  violation_date_time: formData.violationdatetime,
  citation_type: formData.citationtype,
  alleged_speed: formData.allegedspeed,
  posted_speed: formData.postedspeed,
  case_no: formData.caseno,
  
  // Violation Details
  construction_zone: formData.constrzone,
  school_zone: formData.schoolzone,
  accident: formData.accident,
  knew_race: formData.knewrace, // ✅ ADDED MISSING FIELD
  search: formData.search, // ✅ ADDED MISSING FIELD
  contraband: formData.contraband, // ✅ ADDED MISSING FIELD
  
  // Officer & Court
  officer_name: formData.officername,
  officer_id: formData.officerid,
  court_information: formData.courtinformation,
  court_hours: formData.courtHours,
  
  // Additional Vehicle Info ✅ ADDED MISSING FIELDS
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

    // 3. SAVE TO FIRESTORE WITH MANUAL FORM FLAG
    const saveSuccess = await saveToFirestore(
      sessionId, 
      userId, 
      firestoreData, 
      'manual_form_complete', 
      formData.email,
      'manual_form' // ✅ THIS TELLS THE FUNCTION IT'S MANUAL
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