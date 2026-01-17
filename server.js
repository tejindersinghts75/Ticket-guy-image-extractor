const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');

// ✅ SIMPLE MODE SWITCH - Change this value
const MODE = 'prod'; // Change to 'prod' for real AI extraction

// ✅ MOCK DATA EXTRACTION FUNCTION
// ✅ MOCK DATA EXTRACTION FUNCTION
// ✅ MOCK DATA EXTRACTION FUNCTION - UPDATED TO MATCH NEW STRUCTURE
function mockDataExtraction() {
  console.log('🔄 Using MOCK DATA for extraction');

  return {
    ticket_header: {
      county: "Bexar",
      precinct: "3",
      citation_number: "MOCK" + Math.random().toString().slice(2, 8),
      issue_date_and_time: "09/19/2025 at 07:58 AM",
      violation_date_and_time: "09/19/2025 at 07:58 AM"
    },

    violator_information: {
      last_name: "DOE",
      first: "JOHN",
      middle: "", // ✅ Missing - will trigger form
      residence_address: "123 MAIN ST",
      phone: "", // ✅ Missing - will trigger form
      city: "SAN ANTONIO",
      state: "TX",
      zip_code: "78201",
      inter_license_number: "DL123456",
      dl_class: "C",
      dl_state: "TX",
      cdl: "No",
      date_of_birth: "01/01/1980",
      sex: "M",
      race: "H",
      height: "510",
      weight: "180",
      eye_color: "BRO",
      hair_color: "BRO"
    },

    additional_information_business: {
      parent_employer: "",
      address: "",
      phone: "",
      city: "",
      state: "",
      zip_code: ""
    },

    vehicle_information: {
      license_plate: "MOCK123",
      state: "TX",
      reg_exp: "0126",
      color: "BLUE",
      make: "HONDA",
      model: "CIVIC",
      type: "",
      vin: "1HGCM82633A123456",
      year: "2022",
      c_w: "No",
      maxiat: "No",
      trailer_plate: "",
      trailer_state: "",
      dot_number: "",
      towed: "No"
    },

    location_information: {
      address: "1400 E BORGFELD DR",
      direction_of_travel: "",
      direction_of_turn: ""
    },

    violation: {
      citation: "Speeding in School Zone",
      alleged_speed_mph: "44",
      posted_speed_mph: "30",
      case_no: "",
      constr_zone_workers_present: "No",
      school_zone: "Yes",
      accident: "No",
      knewrace: "No",
      search: "No Search",
      contraband: "",
      additional_notes: "ATTENDED AND UNABLE TO VERIFY FINANCIAL RESPONSIBILITY"
    },

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
/**
 * Create admin alert for failed payments
 */
async function createAdminAlertForFailedPayment(session) { // <-- Change parameter name
  try {
    if (!db) return;
    
    await db.collection('admin_alerts').add({
      type: 'payment_failed',
      timestamp: new Date(),
      caseId: session.client_reference_id || 'Unknown', // <-- Use session field
      clientEmail: session.customer_email, // <-- Use session field
      stripeSessionId: session.id, // <-- Changed from paymentIntentId
      // amount: (session.amount_total / 100).toFixed(2), // Optional: Use if needed
      currency: session.currency,
      error: 'Payment failed at checkout', // Generic or parse from last_payment_error if available
      status: 'pending',
      handled: false,
      createdAt: new Date()
    });
    
    console.log(`⚠️ Admin alert created for failed checkout session: ${session.id}`);
  } catch (error) {
    console.error('❌ Failed to create admin alert:', error.message);
  }
}
// Endpoint: POST /api/stripe-webhook
// This endpoint must use raw body for signature verification
// Endpoint: POST /api/stripe-webhook
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    // 1. Verify the webhook is genuinely from Stripe
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`⚠️ Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

    // ✅ ADD DEBUG LOG HERE
  console.log(`✅ Received Stripe event: ${event.type}`);
  console.log('🔍 EVENT DETAILS:', {
    type: event.type,
    sessionId: event.data.object?.id,
    clientRefId: event.data.object?.client_reference_id,
    customerEmail: event.data.object?.customer_email,
    paymentIntent: event.data.object?.payment_intent,
    paymentStatus: event.data.object?.payment_status
  });

  // 2. Handle the specific event
  switch (event.type) {
   case 'checkout.session.completed':
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      await handlePaymentSuccess(session);
    }
    break;
    
  // ADD THIS - For async payment failures
  case 'checkout.session.async_payment_failed':
    const failedSession = event.data.object;
    await handlePaymentFailed(failedSession);
    break;
    
  // ADD THIS - For immediate payment failures
  case 'payment_intent.payment_failed':
  console.log('🔍 PAYMENT INTENT FAILED EVENT DETAILS:', {
    paymentIntentId: event.data.object.id,
    metadata: event.data.object.metadata,
    receipt_email: event.data.object.receipt_email,
    billing_details_email: event.data.object.billing_details?.email
  });
  await handlePaymentIntentFailed(event.data.object);
  break;

    case 'checkout.session.expired':
      // Optional: Handle expired sessions
      const expiredSession = event.data.object;
      console.log(`⌛ Session expired: ${expiredSession.id}`);
      break;

    default:
      console.log(`🔔 Unhandled event type: ${event.type}`);
  }

  // 3. Acknowledge receipt of the event to Stripe
  res.json({ received: true });
});

// ============ HELPER FUNCTIONS ============
// ============ UPDATED PAYMENT EMAIL FUNCTIONS ============

/**
 * Send payment success email (TG_PAYMENT_PAID template)
 */
async function sendPaymentSuccessEmail({ to, name, case_id, citation_number, county, court_name }) {
  try {
    if (!process.env.BREVO_API_KEY) {
      console.log('⚠️ BREVO_API_KEY not set, skipping email');
      return;
    }

   // const portalUrl = `${process.env.PORTAL_BASE_URL}/case/${case_id}`;
   const portalUrl = `${process.env.PORTAL_BASE_URL}`;
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: 'Ticket Guys',
          email: process.env.BREVO_SENDER_EMAIL || 'noreply@texasticketguys.com'
        },
        to: [{ email: to, name: name }],
        subject: 'Payment Received - Your Case is Active | Ticket Guys',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
            <p>Hi ${name},</p>
            
            <p><strong>Payment received</strong> — your Ticket Guys case is now active.</p>
            
            <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #4CAF50; margin: 20px 0;">
              <p><strong>Case ID:</strong> ${case_id}</p>
              <p><strong>Citation:</strong> ${citation_number}</p>
              <p><strong>County/Court:</strong> ${county} — ${court_name || 'Local Court'}</p>
            </div>
            
            <p><strong>What happens next:</strong></p>
            <ul>
              <li>We review your citation details</li>
              <li>We begin the next steps for your case</li>
              <li>You'll receive automatic updates when your case status changes</li>
            </ul>
            
            <p style="margin: 25px 0;">
              <a href="${portalUrl}" 
                 style="background-color: #4CAF50; color: white; padding: 12px 24px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold;">
                Track Your Case Here
              </a>
            </p>
            
            <p>Questions? Reply to this email or call/text ${process.env.SUPPORT_PHONE}.</p>
            
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            
            <p style="font-size: 14px; color: #666;">
              — Ticket Guys<br>
              ${process.env.BUSINESS_HOURS}
            </p>
            
            <p style="font-size: 12px; color: #999; font-style: italic; margin-top: 20px;">
              Note: This message is informational and not legal advice.
            </p>
          </div>
        `,
        tags: ['payment_success', `case_${case_id}`]
      })
    });

    if (response.ok) {
      console.log(`✅ Payment success email sent to ${to} for case ${case_id}`);

      // Log in Firestore
      if (db) {
        await db.collection('email_logs').add({
          to: to,
          type: 'payment_success',
          caseId: case_id,
          sentAt: new Date(),
          status: 'sent'
        });
      }
      return true;
    } else {
      console.error(`❌ Payment success email failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Payment success email error:', error.message);
    return false;
  }
}

/**
 * Send payment failure email (TG_PAYMENT_FAILED template)
 */
async function sendPaymentFailureEmail({ to, name, case_id, citation_number }) {
  try {
    if (!process.env.BREVO_API_KEY) {
      console.log('⚠️ BREVO_API_KEY not set, skipping email');
      return;
    }

    const paymentUpdateUrl = `${process.env.PAYMENT_UPDATE_BASE_URL}/retry/${case_id}`;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: 'Ticket Guys',
          email: process.env.BREVO_SENDER_EMAIL || 'noreply@texasticketguys.com'
        },
        to: [{ email: to, name: name }],
        subject: 'Payment Update Required - Action Needed | Ticket Guys',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
            <p>Hi ${name},</p>
            
            <p>Your payment didn't go through, so your case isn't fully active yet.</p>
            
            <p style="color: #d32f2f; font-weight: bold;">
              In Texas, waiting can create avoidable problems (warrants/added fees and even driver's license renewal issues in some situations).
            </p>
            
            <div style="background: #ffebee; padding: 20px; border-radius: 5px; margin: 25px 0; border: 1px solid #ffcdd2;">
              <p style="font-weight: bold; margin-bottom: 15px;">If you want us to move forward, fix this now:</p>
              
              <p style="margin: 20px 0;">
                <a href="${paymentUpdateUrl}" 
                   style="background-color: #f44336; color: white; padding: 14px 28px; 
                          text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                  Update Payment Here
                </a>
              </p>
              
              <p><strong>Case ID:</strong> ${case_id}</p>
              <p><strong>Citation:</strong> ${citation_number}</p>
            </div>
            
            <p>If you want help by phone, call/text ${process.env.SUPPORT_PHONE} and we'll help immediately.</p>
            
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            
            <p style="font-size: 14px; color: #666;">
              — Ticket Guys<br>
              ${process.env.BUSINESS_HOURS}
            </p>
            
            <p style="font-size: 12px; color: #999; font-style: italic; margin-top: 20px;">
              Note: This message is informational and not legal advice.
            </p>
          </div>
        `,
        tags: ['payment_failed', `case_${case_id}`]
      })
    });

    if (response.ok) { 
      console.log(`⚠️ Payment failure email sent to ${to} for case ${case_id}`);

      // Log in Firestore
      if (db) {
        await db.collection('email_logs').add({
          to: to,
          type: 'payment_failure',
          caseId: case_id,
          sentAt: new Date(),
          status: 'sent'
        });
      }
      return true;
    } else {
      console.error(`❌ Payment failure email failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Payment failure email error:', error.message);
    return false;
  }
}

/**
 * Handle successful payment
 */
async function handlePaymentSuccess(session) {
  const firebaseSessionId = session.client_reference_id;
  console.log(`💰 Payment successful for Firestore session: ${firebaseSessionId}`);

  try {
    // Get ticket data from Firestore
    const ticketRef = db.collection('tickets').doc(firebaseSessionId);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      console.error(`❌ Ticket ${firebaseSessionId} not found in Firestore`);
      return;
    }

    const ticketData = ticketDoc.data();
    const customerEmail = session.customer_email || ticketData.email;

    // Update Firestore
    await ticketRef.update({
      paymentStatus: 'paid',
      caseStatus: 'submitted_for_review',
      paidAt: new Date(),
      stripePaymentIntentId: session.payment_intent,
      stripeSessionId: session.id,
      lastUpdated: new Date(),
      statusHistory: FieldValue.arrayUnion({
        status: 'payment_received',
        timestamp: new Date(),
        note: 'Customer completed payment via Stripe.',
      }),
    });

    console.log(`✅ Firestore updated for session: ${firebaseSessionId}`);

    // ✅ SEND PAYMENT CONFIRMATION EMAIL
    if (customerEmail) {
      await sendPaymentSuccessEmail({
        to: customerEmail,
        name: ticketData.extractedData?.violator_information?.first || "Customer",
        case_id: firebaseSessionId,
        citation_number: ticketData.extractedData?.citation_number || 'N/A',
        county: ticketData.extractedData?.ticket_header?.county || 'N/A',
        court_name: ticketData.extractedData?.court_information || 'Local Court'
      });
    } else {
      console.log('⚠️ No customer email found for payment confirmation');
    }

  } catch (firestoreError) {
    console.error('❌ Firestore update failed:', firestoreError);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(session) {
  const firebaseSessionId = session.client_reference_id;

  console.log(`❌ Payment failed for Firestore session: ${firebaseSessionId}`);

  if (!firebaseSessionId) {
    console.error('No client_reference_id found on failed session.');
    return;
  }

  try {
    const ticketRef = db.collection('tickets').doc(firebaseSessionId);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      console.error(`Ticket ${firebaseSessionId} not found.`);
      return;
    }

    const ticketData = ticketDoc.data();

    // ✅ NEW: Smart way to get email (works for failures)
    const customerEmail =
      session.customer_email ||
      ticketData.email ||
      session?.last_payment_error?.payment_method?.billing_details?.email;

    console.log('📧 Resolved email for failed payment:', customerEmail);

    // ✅ If we found email but Firestore doesn’t have it, store it
    if (customerEmail && !ticketData.email) {
      await ticketRef.update({ email: customerEmail });
      console.log('💾 Saved customer email to Firestore');
    }

    // Update Firestore status
    await ticketRef.update({
      paymentStatus: 'failed',
      lastUpdated: new Date()
    });

    console.log(`✅ Firestore updated for failed payment on session: ${firebaseSessionId}`);

    // ✅ Send failure email (now guaranteed when email exists anywhere)
    if (customerEmail) {
      await sendPaymentFailureEmail({
        to: customerEmail,
        name: ticketData.extractedData?.violator_information?.first || "Customer",
        case_id: firebaseSessionId,
        citation_number: ticketData.extractedData?.citation_number || 'N/A'
      });
    } else {
      console.warn('⚠️ No email found anywhere — cannot send failure email');
    }

    // Create admin alert
    await createAdminAlertForFailedPayment(session);

  } catch (error) {
    console.error('❌ Failed to handle payment failure:', error);
  }
}



/*
 * Handle immediate payment failures (PaymentIntent object)
 */
async function handlePaymentIntentFailed(paymentIntent) {
  console.log('💰 PaymentIntent failed:', paymentIntent.id);

  const firebaseSessionId = paymentIntent.metadata?.firebaseSessionId;

  if (!firebaseSessionId) {
    console.error('❌ No firebaseSessionId in metadata — cannot link to ticket.');
    return;
  }

  // 👉 THIS IS THE KEY LINE — guaranteed email source from Stripe
  const customerEmail =
    paymentIntent.receipt_email ||
    paymentIntent.metadata?.customer_email ||
    paymentIntent.last_payment_error?.payment_method?.billing_details?.email;

  console.log('📧 Email captured from Stripe:', customerEmail);

  if (!customerEmail) {
    console.error('❌ Still no email found — stopping.');
    return;
  }

  // Fetch ticket once
  const ticketRef = db.collection('tickets').doc(firebaseSessionId);
  const ticketDoc = await ticketRef.get();

  if (!ticketDoc.exists) {
    console.error(`❌ Ticket ${firebaseSessionId} not found.`);
    return;
  }

  const ticketData = ticketDoc.data();

  // Save email if missing
  if (!ticketData.email) {
    await ticketRef.update({ email: customerEmail });
    console.log('💾 Saved email to Firestore');
  }

  // Mark payment as failed
  await ticketRef.update({
    paymentStatus: 'failed',
    lastUpdated: new Date()
  });

  console.log('✅ Firestore updated to paymentStatus=failed');

  // 🔥 SEND EMAIL DIRECTLY (no mock session nonsense)
  await sendPaymentFailureEmail({
    to: customerEmail,
    name: ticketData.extractedData?.violator_information?.first || "Customer",
    case_id: firebaseSessionId,
    citation_number: ticketData.extractedData?.citation_number || 'N/A'
  });

  console.log('📨 Failure email triggered.');

  // Still create admin alert
  await createAdminAlertForFailedPayment({
    id: paymentIntent.id,
    client_reference_id: firebaseSessionId,
    customer_email: customerEmail,
    currency: paymentIntent.currency
  });
}


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
    'first_name',  // This should now match `violator_information.first`
    'middle_name', // This should now match `violator_information.middle`
    'last_name',   // This should now match `violator_information.last_name`
    'infraction_violation', // This should now match `violation.citation`
    'phone_number', // This should now match `violator_information.phone`
    'county',      // This should now match `ticket_header.county`
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
      // Now lowercase 'first' instead of 'FIRST'
      if (!extractedData.violator_information?.first ||
        extractedData.violator_information.first.trim() === '') {
        missingFields.push('first_name');
      }
    }
    else if (field === 'middle_name') {
      // Now lowercase 'middle' instead of 'MIDDLE'
      if (!extractedData.violator_information?.middle ||
        extractedData.violator_information.middle.trim() === '') {
        missingFields.push('middle_name');
      }
    }
    else if (field === 'last_name') {
      // Now lowercase 'last_name' instead of 'LAST_NAME'
      if (!extractedData.violator_information?.last_name ||
        extractedData.violator_information.last_name.trim() === '') {
        missingFields.push('last_name');
      }
    }
    else if (field === 'phone_number') {
      // Now lowercase 'phone' instead of 'PHONE'
      if (!extractedData.violator_information?.phone ||
        extractedData.violator_information.phone.trim() === '') {
        missingFields.push('phone_number');
      }
    }
    else if (field === 'infraction_violation') {
      // Now lowercase 'citation' instead of 'CITATION'
      if (!extractedData.violation?.citation ||
        extractedData.violation.citation.trim() === '') {
        missingFields.push('infraction_violation');
      }
    }
    else if (field === 'county') {
      // Now lowercase 'county' instead of 'County'
      if (!extractedData.ticket_header?.county ||
        extractedData.ticket_header.county.trim() === '') {
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
    "county": "[County name]",
    "precinct": "[Precinct number]", 
    "citation_number": "[Citation number]",
    "issue_date_and_time": "[Issue date and time]",
    "violation_date_and_time": "[Violation date and time]"
  },
  
  "violator_information": {
    "last_name": "[Last name]",
    "first": "[First name]",
    "middle": "[Middle name]",
    "residence_address": "[Street address]",
    "phone": "[Phone number or empty]",
    "city": "[City]", 
    "state": "[State]",
    "zip_code": "[ZIP code]",
    "inter_license_number": "[Driver license number]",
    "dl_class": "[License class]",
    "dl_state": "[License state]",
    "cdl": "[Yes/No]",
    "date_of_birth": "[Date of birth]",
    "sex": "[M/F]",
    "race": "[Race code]", 
    "height": "[Height in inches]",
    "weight": "[Weight in lbs]",
    "eye_color": "[Eye color]",
    "hair_color": "[Hair color]"
  },
  
  "additional_information_business": {
    "parent_employer": "[Usually 'PARENT / EMPLOYER' or empty]",
    "address": "[Address or empty]",
    "phone": "[Phone or empty]",
    "city": "[City or empty]",
    "state": "[State or empty]",
    "zip_code": "[ZIP or empty]"
  },
  
  "vehicle_information": {
    "license_plate": "[License plate]",
    "state": "[State]",
    "reg_exp": "[Registration expiration]",
    "color": "[Vehicle color]",
    "make": "[Make]",
    "model": "[Model]",
    "type": "[Vehicle type or empty]",
    "vin": "[VIN number]",
    "year": "[Year]",
    "c_w": "[Yes/No]",
    "maxiat": "[Yes/No]",
    "trailer_plate": "[Trailer plate or empty]",
    "trailer_state": "[Trailer state or empty]",
    "dot_number": "[DOT number or empty]",
    "towed": "[Yes/No]"
  },
  
  "location_information": {
    "address": "[Violation location address]",
    "direction_of_travel": "[Direction or empty]",
    "direction_of_turn": "[Direction or empty]"
  },
  
  "violation": {
    "citation": "[Violation description]",
    "alleged_speed_mph": "[Speed]",
    "posted_speed_mph": "[Speed limit]",
    "case_no": "[Case number or empty]",
    "constr_zone_workers_present": "[Yes/No]",
    "school_zone": "[Yes/No]",
    "accident": "[Yes/No]",
    "knewrace": "[Yes/No]",
    "search": "[Search details]",
    "contraband": "[Contraband or empty]",
    "additional_notes": "[Any additional text]"
  }
}

CRITICAL RULES:
1. Use EXACTLY these lowercase field names (snake_case)
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
    "county": "[County name]",
    "precinct": "[Precinct number]", 
    "citation_number": "[Citation number]",
    "issue_date_and_time": "[Issue date and time]",
    "violation_date_and_time": "[Violation date and time]"
  },
  
  "violator_information": {
    "last_name": "[Last name]",
    "first": "[First name]",
    "middle": "[Middle name]",
    "residence_address": "[Street address]",
    "phone": "[Phone number or empty]",
    "city": "[City]", 
    "state": "[State]",
    "zip_code": "[ZIP code]",
    "inter_license_number": "[Driver license number]",
    "dl_class": "[License class]",
    "dl_state": "[License state]",
    "cdl": "[Yes/No]",
    "date_of_birth": "[Date of birth]",
    "sex": "[M/F]",
    "race": "[Race code]", 
    "height": "[Height in inches]",
    "weight": "[Weight in lbs]",
    "eye_color": "[Eye color]",
    "hair_color": "[Hair color]"
  },
  
  "additional_information_business": {
    "parent_employer": "[Usually 'PARENT / EMPLOYER' or empty]",
    "address": "[Address or empty]",
    "phone": "[Phone or empty]",
    "city": "[City or empty]",
    "state": "[State or empty]",
    "zip_code": "[ZIP or empty]"
  },
  
  "vehicle_information": {
    "license_plate": "[License plate]",
    "state": "[State]",
    "reg_exp": "[Registration expiration]",
    "color": "[Vehicle color]",
    "make": "[Make]",
    "model": "[Model]",
    "type": "[Vehicle type or empty]",
    "vin": "[VIN number]",
    "year": "[Year]",
    "c_w": "[Yes/No]",
    "maxiat": "[Yes/No]",
    "trailer_plate": "[Trailer plate or empty]",
    "trailer_state": "[Trailer state or empty]",
    "dot_number": "[DOT number or empty]",
    "towed": "[Yes/No]"
  },
  
  "location_information": {
    "address": "[Violation location address]",
    "direction_of_travel": "[Direction or empty]",
    "direction_of_turn": "[Direction or empty]"
  },
  
  "violation": {
    "citation": "[Violation description]",
    "alleged_speed_mph": "[Speed]",
    "posted_speed_mph": "[Speed limit]",
    "case_no": "[Case number or empty]",
    "constr_zone_workers_present": "[Yes/No]",
    "school_zone": "[Yes/No]",
    "accident": "[Yes/No]",
    "knewrace": "[Yes/No]",
    "search": "[Search details]",
    "contraband": "[Contraband or empty]",
    "additional_notes": "[Any additional text]"
  }
}

CRITICAL RULES:
1. Use EXACTLY these lowercase field names (snake_case)
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

// Endpoint: POST /api/create-payment-session
app.post('/api/create-payment-session', async (req, res) => {
  try {
    const { sessionId, userEmail } = req.body;

    // 1. VALIDATE SESSION IN FIRESTORE
    const ticketRef = db.collection('tickets').doc(sessionId);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket session not found.' });
    }

    const ticketData = ticketDoc.data();
    if (ticketData.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'Ticket already paid.' });
    }
    if (!['extracted', 'completed'].includes(ticketData.status)) {
      // Ensure it's only payable if data has been submitted
      return res.status(400).json({ error: 'Ticket not ready for payment.' });
    }

    // 2. CREATE STRIPE CHECKOUT SESSION
    // Price is set here. For sandbox, use a small test amount (e.g., $1.00 = 100 cents).
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Traffic Ticket Defense Service',
              description: `Defense for citation: ${ticketData.extractedData?.citation_number || 'N/A'}`,
            },
            // Use an environment variable for price, or hardcode 100 for testing $1.00
            unit_amount: process.env.PRICE_IN_CENTS || 4999, // $49.99 or test amount
          },
          quantity: 1,
        },
      ],
      customer_email: userEmail,
      client_reference_id: sessionId, // The MOST IMPORTANT link to your Firestore document
      metadata: {
        firebaseSessionId: sessionId,
        userId: ticketData.userId,
      },
      payment_intent_data: {
  metadata: {
  firebaseSessionId: sessionId,
  userId: ticketData.userId,
  customer_email: userEmail   // ← CRITICAL ADDITION
},

  },
      // Use your frontend URLs from environment variables
      success_url: `${process.env.FRONTEND_BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_BASE_URL}/upload?session_id=${sessionId}`,
    });

    // 3. UPDATE FIRESTORE WITH PENDING PAYMENT
    await ticketRef.update({
      stripeCheckoutSessionId: stripeSession.id,
      paymentStatus: 'pending',
      lastUpdated: new Date(),
    });

    // 4. RETURN CHECKOUT URL TO FRONTEND
    res.json({ url: stripeSession.url });

  } catch (error) {
    console.error('Payment session creation error:', error);
    res.status(500).json({ error: 'Failed to create payment session.' });
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