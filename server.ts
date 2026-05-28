import express from "express";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import stream from "stream";
import * as adminNamespace from "firebase-admin";
import adminModule from "firebase-admin";

const getAdminModule = () => {
  if (adminModule && typeof adminModule === "object" && "initializeApp" in adminModule) {
    return adminModule;
  }
  if (adminModule && (adminModule as any).default && typeof (adminModule as any).default === "object" && "initializeApp" in (adminModule as any).default) {
    return (adminModule as any).default;
  }
  if (adminNamespace && typeof adminNamespace === "object" && "initializeApp" in adminNamespace) {
    return adminNamespace;
  }
  if (adminNamespace && (adminNamespace as any).default && typeof (adminNamespace as any).default === "object" && "initializeApp" in (adminNamespace as any).default) {
    return (adminNamespace as any).default;
  }
  return adminNamespace || adminModule;
};

const admin = getAdminModule();

const getFirebaseServerTimestamp = () => {
  try {
    const fsNamespace = adminNamespace?.firestore || (admin as any)?.firestore;
    if (fsNamespace && fsNamespace.FieldValue) {
      return fsNamespace.FieldValue.serverTimestamp();
    }
  } catch (e) {
    console.warn("Failed to get firestore FieldValue, loading local timestamp fallback:", e);
  }
  return new Date();
};

const getIndianTimestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const getIndianDateString = (): string => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatToIndianTime = (date: any): string => {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const getAdminDisplayName = (email: string): string => {
  if (!email || !email.includes("@")) return "System Admin";
  return email.split("@")[0].replace(/\./g, " ").trim().toLowerCase();
};

import fs from "fs";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// --- Write-Safe Workspace Path for Serverless Environments (Vercel) ---
const DB_DIR = (process.env.VERCEL || process.env.NODE_ENV === "production") ? "/tmp" : process.cwd();

// --- Error Logging Utility ---
const logErrorToFile = (context: string, err: any, extra?: any) => {
  try {
    const logPath = path.join(DB_DIR, "error_logs.txt");
    const timestamp = new Date().toISOString();
    const errorMessage = err instanceof Error ? err.stack || err.message : String(err);
    const extraStr = extra ? `\nExtra Data: ${JSON.stringify(extra, null, 2)}` : "";
    const entry = `[${timestamp}] CONTEXT: ${context}\nERROR: ${errorMessage}${extraStr}\n---------------------------------------\n`;
    fs.appendFileSync(logPath, entry, "utf-8");
  } catch (e) {
    console.error("Failed to write to error_logs.txt", e);
  }
};

// --- Firebase Admin Initialization ---
let firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
let firebaseDatabaseId = process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID;
let isCustomProject = false;

try {
  // If FIREBASE_PROJECT_ID is not provided in env, fall back to sandbox appletconfig
  if (!firebaseProjectId) {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      firebaseProjectId = config.projectId;
      if (!firebaseDatabaseId) {
        firebaseDatabaseId = config.firestoreDatabaseId;
      }
    }
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

  // If a custom Google Service Account is configured (e.g. expenses@expenses-496705.iam.gserviceaccount.com),
  // extract the correct project ID automatically to align credentials and avoid 7 PERMISSION_DENIED errors.
  if (clientEmail && clientEmail.includes("@") && clientEmail.includes(".iam.gserviceaccount.com")) {
    const extractedProjId = clientEmail.split("@")[1].split(".iam.gserviceaccount.com")[0];
    if (extractedProjId && extractedProjId !== firebaseProjectId) {
      console.log(`[Firebase Security Patch] Auto-aligning project ID to match custom service account: ${extractedProjId} (was ${firebaseProjectId})`);
      firebaseProjectId = extractedProjId;
      isCustomProject = true;
    }
  }

  // If using a custom Project ID, override the sandbox database ID to default,
  // since custom projects do not have the specific AI Studio sandbox database.
  if (isCustomProject || (clientEmail && process.env.GOOGLE_PRIVATE_KEY)) {
    firebaseDatabaseId = process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID || "(default)";
    console.log(`[Firebase Security Patch] Using database ID for production/custom project: ${firebaseDatabaseId}`);
  }

  if (firebaseProjectId) {
    const options: any = {
      projectId: firebaseProjectId,
    };

    if (clientEmail && privateKey) {
      options.credential = admin.credential.cert({
        projectId: firebaseProjectId,
        clientEmail: clientEmail,
        privateKey: privateKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n"),
      });
    }

    admin.initializeApp(options);
    console.log(`Firebase Admin initialized successfully for project: ${firebaseProjectId}`);
  } else {
    console.warn("FIREBASE_PROJECT_ID missing. Firestore operations will fail.");
  }
} catch (error: any) {
  if (error.code !== 'app/duplicate-app') {
    console.error("Firebase Admin initialization error:", error);
  }
}

// --- Firebase Admin Instance Proxy (Lazy Loaded to prevent module-load crashes on Vercel) ---
const isFirestoreEnabled = () => {
  const apps = admin?.apps || adminNamespace?.apps || [];
  if (apps.length === 0) return false;
  
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  const hasServiceAccount = !!(clientEmail && privateKey);
  
  if (hasServiceAccount) return true;
  
  // On Cloud Run (ambient GCP environment), metadata server calls are native, very fast, and authorized by default.
  if (process.env.K_SERVICE) return true;
  
  // If in production or on Vercel but missing service account credentials,
  // firebase-admin queries will block on GCP metadata servers (169.254.169.254) and timeout, causing 500s.
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    console.warn("Firestore access disabled to prevent metadata hang. Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY on Vercel/production.");
    return false;
  }
  
  return true;
};

const createMockFirestore = () => {
  const mockDoc: any = {
    set: async () => ({}),
    get: async () => ({ exists: false, data: () => null }),
    update: async () => ({}),
    delete: async () => ({}),
    collection: () => mockCollection
  };
  
  const mockQuery: any = {
    limit: () => mockQuery,
    orderBy: () => mockQuery,
    get: async () => ({ docs: [], size: 0 })
  };
  
  const mockCollection: any = {
    doc: () => mockDoc,
    limit: () => mockQuery,
    orderBy: () => mockQuery,
    get: async () => ({ docs: [], size: 0 })
  };
  
  const mockBatch: any = {
    set: () => mockBatch,
    update: () => mockBatch,
    delete: () => mockBatch,
    commit: async () => {}
  };
  
  return {
    collection: (name: string) => mockCollection,
    batch: () => mockBatch,
  } as any;
};

let firestoreInstance: adminNamespace.firestore.Firestore | null = null;
const getFirestoreInstance = () => {
  if (!firestoreInstance) {
    if (!isFirestoreEnabled()) {
      console.warn("Firestore is disabled or unconfigured in this environment. Initializing safe mock.");
      firestoreInstance = createMockFirestore();
      return firestoreInstance;
    }
    try {
      firestoreInstance = (firebaseDatabaseId && firebaseDatabaseId !== "(default)") ? (admin.app() as any).firestore(firebaseDatabaseId) : admin.firestore();
    } catch (err) {
      console.error("Failed to fetch firestore instance, falling back to mock:", err);
      firestoreInstance = createMockFirestore();
    }
  }
  return firestoreInstance;
};

const db = new Proxy({} as adminNamespace.firestore.Firestore, {
  get(target, prop) {
    // Return early for known inspection/prototype calls to prevent auto-initializing
    if (
      prop === "then" || 
      prop === "inspect" || 
      prop === "toJSON" || 
      prop === "toString" ||
      typeof prop === "symbol" || 
      prop === "util.inspect.custom" ||
      prop === "prototype" ||
      prop === "constructor"
    ) {
      return undefined;
    }
    const instance = getFirestoreInstance();
    const val = Reflect.get(instance, prop);
    return typeof val === "function" ? val.bind(instance) : val;
  }
});

// --- Supabase Client & Database Initialization ---
const SUPABASE_URL = process.env.SUPABASE_URL || "https://yrbidrfhzuxmxqcboqfd.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyYmlkcmZoenV4bXhxY2JvcWZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NDAzMzQsImV4cCI6MjA5NTAxNjMzNH0.TlJGDC6gzho4jWVdrgFyNSSM9Fb0kX6UI5ifXfXwrfQ";

let supabaseClient: any = null;
try {
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
  console.log("Supabase Client initialized successfully!");
} catch (err) {
  console.error("Failed to initialize Supabase client:", err);
}

// Map Supabase flat columns back to the frontend's nested/custom structure
const mapSupabaseRowToClaim = (sr: any, index: number) => ({
  rowIndex: index + 2,
  sheetName: sr.branch_name || "Sheet1",
  timestamp: sr.timestamp || "",
  submissionid: sr.submission_id || "",
  branchname: sr.branch_name || "Sheet1",
  salespersonname: sr.salesperson_name || "",
  expensecategory: sr.expense_category || "",
  itemdate: sr.item_date || "",
  fromlocation: sr.from_location || "",
  tolocation: sr.to_location || "",
  amount: String(sr.amount || "0"),
  attachmentlink: sr.attachment_link || "",
  itemremark: sr.item_remark || "",
  grandtotal: String(sr.grand_total || "0"),
  adminremark: sr.admin_remark || "",
  mailsent: sr.mail_sent || "No",
  approved: sr.approved || "No",
  approvedtimestamp: sr.approved_timestamp || "",
  paymentprocess: sr.payment_process || "No",
  processedby: sr.processed_by || "",
  status: sr.status || "Pending",
  paymentrelease: sr.payment_release || "No",
  releasedby: sr.released_by || "",
  employeeemail: sr.salesperson_email || "",
  branchheademail: sr.branch_head_email || ""
});

const getSupabaseClaims = async (): Promise<any[] | null> => {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from("expense_claims")
      .select("*")
      .order("id", { ascending: false });
    
    if (error) {
      console.error("Supabase fetch claims error:", error.message);
      return null;
    }
    return (data || []).map((row: any, idx: number) => mapSupabaseRowToClaim(row, idx));
  } catch (err: any) {
    console.error("Supabase fetch claims exception:", err.message);
    return null;
  }
};

const saveSupabaseClaims = async (rows: any[]): Promise<boolean> => {
  if (!supabaseClient) return false;
  try {
    const mappedRows = rows.map(r => ({
      submission_id: r.submissionid || "",
      timestamp: r.timestamp || "",
      branch_name: r.branchname || "Sheet1",
      salesperson_name: r.salespersonname || "",
      salesperson_email: r.employeeemail || "",
      expense_category: r.expensecategory || "",
      item_date: r.itemdate || "",
      from_location: r.fromlocation || "",
      to_location: r.tolocation || "",
      amount: String(r.amount || "0"),
      attachment_link: r.attachmentlink || "",
      item_remark: r.itemremark || "",
      grand_total: String(r.grandtotal || "0"),
      admin_remark: r.adminremark || "",
      mail_sent: r.mailsent || "No",
      approved: r.approved || "No",
      approved_timestamp: r.approvedtimestamp || "",
      payment_process: r.paymentprocess || "No",
      processed_by: r.processedby || "",
      status: r.status || "Pending",
      payment_release: r.paymentrelease || "No",
      released_by: r.releasedby || "",
      branch_head_email: r.branchheademail || ""
    }));

    const { error } = await supabaseClient
      .from("expense_claims")
      .insert(mappedRows);
    
    if (error) {
      console.error("Supabase insert error:", error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("Supabase insert exception:", err.message);
    return false;
  }
};

const updateSupabaseClaim = async (claimId: string, updates: any): Promise<boolean> => {
  if (!supabaseClient) return false;
  try {
    const mappedUpdates: any = {};
    if (updates.adminremark !== undefined) mappedUpdates.admin_remark = updates.adminremark;
    if (updates.mailsent !== undefined) mappedUpdates.mail_sent = updates.mailsent;
    if (updates.status !== undefined) mappedUpdates.status = updates.status;
    if (updates.approved !== undefined) mappedUpdates.approved = updates.approved;
    if (updates.approvedtimestamp !== undefined) mappedUpdates.approved_timestamp = updates.approvedtimestamp;
    if (updates.paymentprocess !== undefined) mappedUpdates.payment_process = updates.paymentprocess;
    if (updates.processedby !== undefined) mappedUpdates.processed_by = updates.processedby;
    if (updates.paymentrelease !== undefined) mappedUpdates.payment_release = updates.paymentrelease;
    if (updates.releasedby !== undefined) mappedUpdates.released_by = updates.releasedby;

    const { error } = await supabaseClient
      .from("expense_claims")
      .update(mappedUpdates)
      .eq("submission_id", claimId);
    
    if (error) {
      console.error("Supabase update error:", error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("Supabase update exception:", err.message);
    return false;
  }
};

const getSupabaseAdmin = async (email: string): Promise<any | null> => {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from("admins")
      .select("*")
      .eq("email", email.toLowerCase().trim());
    if (error || !data || data.length === 0) {
      return null;
    }
    return data[0];
  } catch (e: any) {
    console.error("Supabase get admin exception:", e.message);
    return null;
  }
};

const saveSupabaseAdmin = async (email: string, name: string, password: string): Promise<boolean> => {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient
      .from("admins")
      .upsert({ email: email.toLowerCase().trim(), name, password });
    if (error) {
      console.error("Supabase save admin error:", error.message);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error("Supabase save admin exception:", e.message);
    return false;
  }
};

const app = express();
const PORT = 3000;

// --- Safe Fallback Persistent JSON Databases ---
const ADMINS_FILE = path.join(DB_DIR, "admins_database.json");
const CLAIMS_FILE = path.join(DB_DIR, "claims_database.json");
const MAIL_MAP_FILE = path.join(DB_DIR, "mail_map_database.json");

const loadLocalJSON = (filePath: string, defaultVal: any) => {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    // Fallback: If DB_DIR is /tmp, look in the project root process.cwd() for the file
    const baseName = path.basename(filePath);
    const fallbackPath = path.join(process.cwd(), baseName);
    if (fs.existsSync(fallbackPath)) {
      console.log(`Loading fallback local database from project root: ${fallbackPath}`);
      return JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
    }
  } catch (err) {
    console.error(`Error loading local JSON from ${filePath}:`, err);
  }
  return defaultVal;
};

const saveLocalJSON = (filePath: string, data: any) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`Error saving local JSON to ${filePath}:`, err);
  }
};

let fallbackClaims: any[] = loadLocalJSON(CLAIMS_FILE, []);
const fallbackEmailMap: { [key: string]: string } = loadLocalJSON(MAIL_MAP_FILE, {});

const initialAdmins = loadLocalJSON(ADMINS_FILE, {
  "admin@expense.com": {
    name: "Default Admin",
    email: "admin@expense.com",
    password: "admin123"
  },
  "mis.mumbai@ginzalimited.com": {
    name: "Mumbai Admin",
    email: "mis.mumbai@ginzalimited.com",
    password: "admin123"
  }
});
const fallbackAdmins = new Map<string, any>(Object.entries(initialAdmins));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- Google Client Helper ---
const getGoogleAuth = async () => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

  if (!clientEmail || !privateKey) {
    console.error("Missing Google Credentials: EMAIL length:", clientEmail?.length || 0, "KEY length:", privateKey?.length || 0);
    throw new Error("Google Service Account credentials (EMAIL or PRIVATE_KEY) are missing in environment variables.");
  }

  // Handle potential double-quotes and escaped newlines commonly found in environment variables
  privateKey = privateKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n");

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file"
    ],
  });
};

const getSheetsClient = async () => {
  const auth = await (await getGoogleAuth()).getClient();
  return google.sheets({ version: "v4", auth: auth as any });
};

const getDriveClient = async () => {
  const auth = await (await getGoogleAuth()).getClient();
  return google.drive({ version: "v3", auth: auth as any });
};

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1L6iVHvBuknqum6lFf26BAp1_wrEwyyqwnj5o3lznCZ4";
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const HEADERS = [
  "Timestamp", "Submission ID", "Branch Name", "Salesperson Name", "Expense Category", 
  "Item Date", "From Location", "To Location", "Amount", "Attachment Link", "Item Remark", 
  "Grand Total", "Admin Remark", "Mail Sent", "Approved", 
  "Approved Timestamp", "Payment Process", "Processed By", 
  "Status", "Payment Release", "Released By"
];

// Helper to ensure a sheet exists and has headers
const ensureSheetExists = async (sheets: any, spreadsheetId: string, title: string, existingTitles?: string[]) => {
  let exists = false;
  if (existingTitles) {
    exists = existingTitles.includes(title);
  } else {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    exists = (spreadsheet.data.sheets || []).some((s: any) => s.properties?.title === title);
  }

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }]
      }
    });
    // Add headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [HEADERS] }
    });
  }
  return title;
};

// Helper for private email storage
const getEmailMapping = async (sheets: any, spreadsheetId: string) => {
  const title = "_Mails_";
  await ensureSheetExists(sheets, spreadsheetId, title);
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A:B` });
  const rows = response.data.values || [];
  return getEmailMappingFromRows(rows);
};

const getEmailMappingFromRows = (rows: string[][]) => {
  const map: { [key: string]: string } = {};
  rows.forEach((row: string[]) => {
    if (row[0]) map[row[0]] = row[1];
  });
  return map;
};

const saveEmailMapping = async (sheets: any, spreadsheetId: string, submissionId: string, email: string) => {
  const title = "_Mails_";
  await ensureSheetExists(sheets, spreadsheetId, title);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${title}!A:B`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[submissionId, email]] }
  });
};

// Helper to get the correct range/sheet name
const getSheetRange = async (sheets: any, spreadsheetId: string, baseRange: string) => {
  try {
    // Try original range first
    await sheets.spreadsheets.values.get({ spreadsheetId, range: baseRange });
    return baseRange;
  } catch (error: any) {
    if (error.message.includes("Unable to parse range")) {
      // If "Sheet1" fails, try to get the first sheet's actual name
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const firstSheetName = spreadsheet.data.sheets?.[0]?.properties?.title;
      if (firstSheetName) {
        console.log(`Sheet1 not found. Using first sheet: "${firstSheetName}"`);
        return `${firstSheetName}!${baseRange.split('!')[1] || baseRange}`;
      }
    }
    throw error;
  }
};

const RANGE = "Sheet1!A:Z"; 

// --- Drive Upload Helper ---
const uploadToDrive = async (fileName: string, base64Data: string, mimeType: string) => {
  try {
    const drive = await getDriveClient();
    const buffer = Buffer.from(base64Data.split(',')[1] || base64Data, 'base64');
    
    const fileMetadata = {
      name: fileName,
      parents: FOLDER_ID ? [FOLDER_ID] : undefined,
    };
    const media = {
      mimeType: mimeType,
      body: stream.Readable.from(buffer),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    // Make file readable by anyone with the link (optional but helpful for admins)
    await drive.permissions.create({
      fileId: file.data.id!,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    return file.data.webViewLink;
  } catch (error) {
    console.error("Drive Upload Error:", error);
    return "Upload Failed";
  }
};

// --- Email Helper ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendMail = async (to: string, cc: string, subject: string, text: string, fromName?: string, replyTo?: string) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP credentials missing. Email skipped.");
    return;
  }
  try {
    // We use a display name that includes the user's email if provided
    // but the actual 'from' address must remain the authenticated SMTP_USER to avoid spam filters/refusal
    const displayName = fromName ? `${fromName}${replyTo ? ` (${replyTo})` : ''}` : (process.env.SMTP_USER_NAME || 'Expense System');
    
    const isHtml = text.trim().startsWith("<") || text.includes("<table") || text.includes("<div");
    await transporter.sendMail({
      from: `"${displayName}" <${process.env.SMTP_USER}>`,
      replyTo: replyTo || process.env.SMTP_USER,
      to,
      cc,
      subject,
      text: isHtml ? text.replace(/<[^>]*>/g, '') : text,
      html: isHtml ? text : undefined,
    });
    console.log(`Email sent to ${to} (CC: ${cc})`);
  } catch (error) {
    console.error("Email error:", error);
  }
};

// --- API Routes ---

// --- Admin Authentication Routes ---

// Optional: Register a new admin account
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    const lowerEmail = email.toLowerCase().trim();

    // Store in-memory fallback & persist to JSON database
    fallbackAdmins.set(lowerEmail, { name, email: lowerEmail, password });
    saveLocalJSON(ADMINS_FILE, Object.fromEntries(fallbackAdmins));

    // Store in Supabase if configured
    try {
      await saveSupabaseAdmin(lowerEmail, name, password);
    } catch (sbErr) {
      console.warn("Supabase save skipped during register:", sbErr);
    }

        // Store in Firestore (with safe try-catch so it doesn't fail if Firestore is off)
    try {
      if (isFirestoreEnabled()) {
        await db.collection("admins").doc(lowerEmail).set({
          name,
          email: lowerEmail,
          password,
          createdAt: getFirebaseServerTimestamp()
        });
      }
    } catch (fsErr) {
      console.warn("Firestore save skipped during register:", fsErr);
    }

    res.json({ success: true, user: { name, email: lowerEmail } });
  } catch (err: any) {
    console.error("Register Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Login admin account
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const lowerEmail = email.toLowerCase().trim();

    // 1. Check fallback memory
    let adminUser = fallbackAdmins.get(lowerEmail);

    // Support flexible "admin" / "admin123" for default admins
    if (lowerEmail === "admin@expense.com" && (password === "admin" || password === "admin123")) {
      return res.json({
        success: true,
        user: { name: "Default Admin", email: "admin@expense.com" }
      });
    }

    if (lowerEmail === "mis.mumbai@ginzalimited.com" && (password === "admin" || password === "admin123")) {
      return res.json({
        success: true,
        user: { name: "Mumbai Admin", email: "mis.mumbai@ginzalimited.com" }
      });
    }

    // Try Supabase first (if configured and memory fails)
    if (!adminUser) {
      try {
        const sbAdmin = await getSupabaseAdmin(lowerEmail);
        if (sbAdmin && sbAdmin.password === password) {
          adminUser = { name: sbAdmin.name, email: sbAdmin.email, password: sbAdmin.password };
          fallbackAdmins.set(lowerEmail, adminUser);
        }
      } catch (sbErr) {
        console.warn("Supabase check skipped during login:", sbErr);
      }
    }

    // 2. Check Firestore if memory doesn't have it (or to sync down)
    if (!adminUser) {
      try {
        if (isFirestoreEnabled()) {
          const doc = await db.collection("admins").doc(lowerEmail).get();
          if (doc.exists) {
            const data = doc.data();
            if (data && data.password === password) {
              adminUser = { name: data.name, email: data.email, password: data.password };
              // Cache back into memory
              fallbackAdmins.set(lowerEmail, adminUser);
            }
          }
        }
      } catch (fsErr) {
        console.warn("Firestore check skipped during login:", fsErr);
      }
    }

    if (adminUser && adminUser.password === password) {
      return res.json({
        success: true,
        user: { name: adminUser.name, email: adminUser.email }
      });
    }

    res.status(401).json({ error: "Invalid email or password" });
  } catch (err: any) {
    console.error("Login Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 1. Submit Claim
app.post("/api/claim", async (req, res) => {
  try {
    const { 
      branchName, salespersonName, salespersonEmail, 
      items, grandTotal, branchHeadEmail
    } = req.body;

    const submissionId = `EXP-${Date.now()}`;
    const timestamp = getIndianTimestamp();

    // Process File Uploads (Safe Google Drive attachment helper)
    let driveClient: any = null;
    try {
      driveClient = await getDriveClient();
    } catch (e: any) {
      console.warn("Google Drive client not available (using mockup values):", e.message);
    }

    const processedItems = await Promise.all(items.map(async (item: any, idx: number) => {
      let attachmentUrl = item.attachment;
      if (item.fileData && item.fileName && driveClient) {
        try {
          attachmentUrl = await uploadToDrive(
            `${submissionId}_item${idx+1}_${item.fileName}`,
            item.fileData,
            item.fileType
          ) || "Upload Failed";
        } catch (uploadError) {
          console.error("Google Drive Upload failed:", uploadError);
          attachmentUrl = "Upload Failed (Google Drive Error)";
        }
      } else if (item.fileData && item.fileName) {
        attachmentUrl = item.attachment || "Attachment Loaded (Local Copy Only)";
      }
      return { ...item, attachment: attachmentUrl };
    }));

    // Backwards-compatible row format for our local cache mapping
    const localRows = processedItems.map((item: any, idx: number) => ({
      rowIndex: idx + 2,
      sheetName: branchName || "Sheet1",
      timestamp,
      submissionid: submissionId,
      branchname: branchName || "Sheet1",
      salespersonname: salespersonName,
      expensecategory: item.category,
      itemdate: item.itemDate,
      fromlocation: item.fromLoc || "",
      tolocation: item.toLoc || "",
      amount: String(item.amount),
      attachmentlink: item.attachment || "",
      itemremark: item.remark || "",
      grandtotal: String(grandTotal),
      adminremark: "",
      mailsent: "No",
      approved: "No",
      approvedtimestamp: "",
      paymentprocess: "No",
      processedby: "",
      status: "Pending",
      paymentrelease: "No",
      releasedby: "",
      employeeemail: salespersonEmail,
      branchheademail: branchHeadEmail
    }));

    // Save into server-side cache immediately for instant local reflection
    fallbackClaims.push(...localRows);
    fallbackEmailMap[submissionId] = salespersonEmail;
    saveLocalJSON(CLAIMS_FILE, fallbackClaims);
    saveLocalJSON(MAIL_MAP_FILE, fallbackEmailMap);

    // --- SUPABASE SYNC (Safe Try-Catch) ---
    try {
      if (supabaseClient) {
        const savedSb = await saveSupabaseClaims(localRows);
        if (savedSb) {
          console.log(`Claim ${submissionId} synced to Supabase.`);
        }
      }
    } catch (sbError) {
      console.error("Supabase Save Error (handled gracefully):", sbError);
    }

    // --- FIRESTORE SYNC (Safe Try-Catch) ---
    try {
      if (isFirestoreEnabled()) {
        const claimRef = db.collection('claims').doc(submissionId);
        await claimRef.set({
          submissionId,
          branchName: branchName || "Unknown",
          salespersonName: salespersonName || "Unknown",
          employeeEmail: salespersonEmail,
          grandTotal: Number(grandTotal),
          status: 'PENDING',
          createdAt: getFirebaseServerTimestamp(),
          mailSent: false
        });

        const itemsBatch = db.batch();
        processedItems.forEach((item, idx) => {
          const itemRef = claimRef.collection('items').doc(`item_${idx}`);
          itemsBatch.set(itemRef, {
            category: item.category,
            itemDate: item.itemDate,
            fromLoc: item.fromLoc || "",
            toLoc: item.toLoc || "",
            amount: Number(item.amount),
            attachmentLink: item.attachment || "",
            remark: item.remark || ""
          });
        });
        await itemsBatch.commit();
        console.log(`Claim ${submissionId} synced to Firestore.`);
      }
    } catch (fsError) {
      console.error("Firestore Save Error (handled gracefully):", fsError);
    }

    // --- GOOGLE SHEETS ACCESS (Safe Try-Catch) ---
    try {
      const sheets = await getSheetsClient();
      const sheetTitle = branchName || "Sheet1";
      await ensureSheetExists(sheets, SHEET_ID, sheetTitle);
      await saveEmailMapping(sheets, SHEET_ID, submissionId, salespersonEmail);

      const rows = processedItems.map((item: any) => [
        timestamp || "", 
        submissionId || "", 
        branchName || "", 
        salespersonName || "", 
        item.category || "", 
        item.itemDate || "", 
        item.fromLoc || "", 
        item.toLoc || "", 
        item.amount || "", 
        item.attachment || "", 
        item.remark || "", 
        grandTotal || 0,
        "", // Admin Remark
        "No", // Mail Sent
        "No", // Approved
        "", // Approved Timestamp
        "No", // Payment Process
        "", // Processed By
        "Pending", // Status
        "No", // Payment Release
        ""  // Released By
      ]);

      const appendResponse = await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${sheetTitle}!A:U`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });

      // Merge Cells Logic for multi-item submissions
      if (items.length > 1) {
        try {
          const updatedRange = appendResponse.data.updates?.updatedRange;
          if (updatedRange) {
            const rangePart = updatedRange.split('!').pop();
            const rowsMatch = rangePart?.match(/[A-Z]+(\d+):[A-Z]+(\d+)/) || updatedRange.match(/(\d+):[A-Z]+(\d+)/);
            if (rowsMatch) {
              const startRowIndex = parseInt(rowsMatch[1]) - 1; // 0-indexed
              const endRowIndex = parseInt(rowsMatch[2]); // Exclusive
              
              const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
              const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetTitle);
              const sheetId = sheet?.properties?.sheetId;

              if (sheetId !== undefined) {
                const columnsToMerge = [0, 1, 2, 3, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
                const requests = columnsToMerge.map(colIndex => ({
                  mergeCells: {
                    range: {
                      sheetId,
                      startRowIndex,
                      endRowIndex,
                      startColumnIndex: colIndex,
                      endColumnIndex: colIndex + 1
                    },
                    mergeType: "MERGE_ALL"
                  }
                }));

                await sheets.spreadsheets.batchUpdate({
                  spreadsheetId: SHEET_ID,
                  requestBody: { requests }
                });
              }
            }
          }
        } catch (mergeError) {
          console.error("Merging Error (non-blocking):", mergeError);
        }
      }
    } catch (sheetError: any) {
      console.warn("Google Sheets save skipped/failed (using fallback and database stores):", sheetError.message);
    }

    // Notify Admins & Branch Head (Safe SMTP routing)
    try {
      const adminEmailsRaw = process.env.ADMIN_EMAILS || "mis.mumbai@ginzalimited.com";
      const adminsList = adminEmailsRaw.split(",").map(e => e.trim()).filter(Boolean);
      if (!adminsList.includes("mis.mumbai@ginzalimited.com")) {
        adminsList.push("mis.mumbai@ginzalimited.com");
      }
      const adminEmails = adminsList.join(",");
      const recipients = branchHeadEmail ? `${adminEmails},${branchHeadEmail}` : adminEmails;
      
      const emailSubject = `New Claim Submitted - ${salespersonName} (${branchName})`;
      const emailBody = `Dear Admin,\n\nA new expense claim has been successfully submitted by ${salespersonName}.\n\n--- Claimant Information ---\nName: ${salespersonName}\nEmail: ${salespersonEmail}\nBranch: ${branchName}\nSubmission ID: ${submissionId}\nTotal Amount: ₹${grandTotal}\nTotal Items: ${items.length}\n\nGoogle Spreadsheet Link:\nhttps://docs.google.com/spreadsheets/d/${SHEET_ID}\n\nPlease click on the review link or log into the Admin portal to manage this claim.`;

      await sendMail(
        recipients,
        "",
        emailSubject,
        emailBody,
        salespersonName,
        salespersonEmail
      );
    } catch (mailErr) {
      console.error("Safe notification skip:", mailErr);
    }

    res.json({ success: true, submissionId });
  } catch (error: any) {
    console.error("Submit Error:", error);
    logErrorToFile("Submit Claim API", error, { body: req.body });
    res.status(500).json({ error: error.message });
  }
});

// --- Diagnostics Endpoint for Vercel Deployment Troubleshooting ---
app.get("/api/diagnose", async (req, res) => {
  const report: any = {
    timestamp: new Date().toISOString(),
    environment: {
      isVercel: !!process.env.VERCEL,
      nodeEnv: process.env.NODE_ENV || "not set",
    },
    googleCredentials: {
      emailConfigured: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      emailLength: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.length || 0,
      emailValue: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? `${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.slice(0, 10)}...` : "missing",
      keyConfigured: !!process.env.GOOGLE_PRIVATE_KEY,
      keyLength: process.env.GOOGLE_PRIVATE_KEY?.length || 0,
      keyStartsWithBegin: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.includes("-----BEGIN PRIVATE KEY-----") : false,
      keyEndsWithEnd: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.includes("-----END PRIVATE KEY-----") : false,
      keyContainsRawNewlines: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.includes("\n") : false,
      keyContainsEscapedNewlines: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.includes("\\n") : false,
      spreadsheetIdConfigured: !!process.env.GOOGLE_SHEET_ID,
      spreadsheetId: SHEET_ID,
    },
    firebaseConfig: {
      projectIdConfigured: !!process.env.FIREBASE_PROJECT_ID,
      projectId: process.env.FIREBASE_PROJECT_ID || "missing",
      databaseId: firebaseDatabaseId || "default",
    },
    smtpConfig: {
      smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
      smtpUserConfigured: !!process.env.SMTP_USER,
      smtpUser: process.env.SMTP_USER ? `${process.env.SMTP_USER.slice(0, 5)}...` : "missing",
      smtpPassConfigured: !!process.env.SMTP_PASS,
    },
    checks: {}
  };

  // Check 1: Google Auth & Sheets connection
  try {
    const sheets = await getSheetsClient();
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    report.checks.googleSheets = {
      status: "success",
      title: spreadsheet.data.properties?.title || "No Title",
      sheetsCount: spreadsheet.data.sheets?.length || 0,
      sheetNames: spreadsheet.data.sheets?.map(s => s.properties?.title)
    };
  } catch (err: any) {
    report.checks.googleSheets = {
      status: "failed",
      error: err.message,
      code: err.code,
      details: err.response?.data?.error || err.toString()
    };
  }

  // Check 2: Firestore Admin connection
  try {
    const testDoc = await db.collection("claims").limit(1).get();
    report.checks.firestore = {
      status: "success",
      documentsFetched: testDoc.size
    };
  } catch (err: any) {
    let suggestion = "";
    const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
    const fsProj = process.env.FIREBASE_PROJECT_ID || "";
    if (saEmail && fsProj) {
      const match = saEmail.match(/@([^.]+)/);
      const saProj = match ? match[1] : "";
      if (saProj && saProj !== fsProj) {
        suggestion = `Project ID mismatch! Your Google Service Account belongs to project "${saProj}", but FIREBASE_PROJECT_ID is "${fsProj}". To fix this 7 PERMISSION_DENIED error, please go to the GCP/Firebase Console of project "${fsProj}", under IAM & Admin, and add the principal "${saEmail}" with the role "Cloud Datastore User" or "Cloud Datastore Owner".`;
      }
    }
    report.checks.firestore = {
      status: "failed",
      error: err.message,
      suggestion: suggestion || "Make sure your service account has rights to access Firestore in the console.",
      details: err.toString()
    };
  }

  // Decide overall status code - only fail if critical Google Sheets connection fails
  const hasFailedCheck = report.checks.googleSheets?.status === "failed";
  res.status(200).json(report);
});

// 2. Get Claims for Admin
app.get("/api/claims", async (req, res) => {
  const sendMappedClaims = (rawClaims: any[]) => {
    const mapped = (rawClaims || []).map(item => ({
      id: item.submissionid || item.id || `CLM-${Date.now()}`,
      claimDate: item.itemdate || item.claimDate || "",
      submitDate: item.timestamp || item.submitDate || "",
      claimantName: item.salespersonname || item.claimantName || "",
      claimantEmail: item.employeeemail || item.claimantEmail || item.salesperson_email || "",
      title: item.itemremark || item.title || "Expense Claim",
      amount: Number(item.amount) || Number(item.grandtotal) || 0,
      category: item.expensecategory || item.category || "Other Expenses",
      branch: item.branchname || item.branch || "",
      description: item.itemremark || item.description || "",
      attachmentUrl: item.attachmentlink || item.attachmentUrl || "",
      status: item.status || "Pending",
      remarks: item.adminremark || item.remarks || "",
      rowIndex: item.rowIndex || 2,
      sheetName: item.sheetName || item.branchname || item.branch || "Sheet1",
      approved: item.approved || "No",
      approvedDetails: item.approveddetails || item.approvedtimestamp || "",
      paymentProcess: item.paymentprocess || "No",
      processedBy: item.processedby || "",
      paymentRelease: item.paymentrelease || "No",
      releasedBy: item.releasedby || ""
    }));
    return res.json({ success: true, claims: mapped });
  };

  try {
    // 1. Try Google Sheets first
    try {
      const sheets = await getSheetsClient();
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
      const currentTitles = (spreadsheet.data.sheets || []).map(s => s.properties?.title || "");
      const sheetTitles = currentTitles.filter(title => title && title !== "_Mails_" && title !== "Sheet1");

      const hasMailsSheet = currentTitles.includes("_Mails_");
      if (!hasMailsSheet) {
        try {
          await ensureSheetExists(sheets, SHEET_ID, "_Mails_", currentTitles);
        } catch (e) {
          console.warn("Could not create _Mails_ sheet:", e);
        }
      }

      // Batch GET both "_Mails_" map sheet and all other branch sheets in a single API call
      const ranges = ["_Mails_!A:B", ...sheetTitles.map(title => `${title}!A:U`)];
      const batchResponse = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SHEET_ID,
        ranges,
      });

      const valueRanges = batchResponse.data.valueRanges || [];
      const mailsRows = valueRanges[0]?.values || [];
      const emailMap = getEmailMappingFromRows(mailsRows);

      let allClaims: any[] = [];
      sheetTitles.forEach((title, idx) => {
        const rows = valueRanges[idx + 1]?.values || [];
        if (rows.length < 2) return;

        const headers = rows[0];
        let lastSeenClaimObj: any = null;

        const data = rows.slice(1).map((row, index) => {
          const obj: any = { rowIndex: index + 2, sheetName: title }; 
          headers.forEach((header: string, i: number) => {
            const key = header.toLowerCase().replace(/ /g, "");
            obj[key] = row[i] || "";
          });

          // Fill down merged cell values if this row is part of a merged block (identified by empty submissionid)
          if (!obj.submissionid && lastSeenClaimObj) {
            obj.submissionid = lastSeenClaimObj.submissionid || "";
            obj.timestamp = lastSeenClaimObj.timestamp || "";
            obj.branch = lastSeenClaimObj.branch || "";
            obj.branchname = lastSeenClaimObj.branchname || lastSeenClaimObj.branch || "";
            obj.name = lastSeenClaimObj.name || "";
            obj.salespersonname = lastSeenClaimObj.salespersonname || lastSeenClaimObj.name || "";
            obj.grandtotal = lastSeenClaimObj.grandtotal || "";
            obj.adminremark = lastSeenClaimObj.adminremark || "";
            obj.mailsent = lastSeenClaimObj.mailsent || "";
            obj.approved = lastSeenClaimObj.approved || "";
            obj.approveddetails = lastSeenClaimObj.approveddetails || "";
            obj.approvedtimestamp = lastSeenClaimObj.approvedtimestamp || lastSeenClaimObj.approveddetails || "";
            obj.paymentprocess = lastSeenClaimObj.paymentprocess || "";
            obj.processedby = lastSeenClaimObj.processedby || "";
            obj.status = lastSeenClaimObj.status || "";
            obj.paymentrelease = lastSeenClaimObj.paymentrelease || "";
            obj.releasedby = lastSeenClaimObj.releasedby || "";
          } else if (obj.submissionid) {
            lastSeenClaimObj = obj;
          }

          // Dynamic backwards compatibility mapping for simple vs full headers
          if (obj.branch && !obj.branchname) obj.branchname = obj.branch;
          if (obj.name && !obj.salespersonname) obj.salespersonname = obj.name;
          if (obj.category && !obj.expensecategory) obj.expensecategory = obj.category;
          if (obj.date && !obj.itemdate) obj.itemdate = obj.date;
          if (obj.from && !obj.fromlocation) obj.fromlocation = obj.from;
          if (obj.to && !obj.tolocation) obj.tolocation = obj.to;
          if (obj.attachment && !obj.attachmentlink) obj.attachmentlink = obj.attachment;
          if (obj.remark && !obj.itemremark) obj.itemremark = obj.remark;
          if (obj.approveddetails && !obj.approvedtimestamp) obj.approvedtimestamp = obj.approveddetails;

          // Restore email from map
          obj.employeeemail = emailMap[obj.submissionid] || "";
          return obj;
        });
        allClaims = [...allClaims, ...data];
      });

      // Merge with in-memory claims that aren't already fetched
      const mergedClaims = [...allClaims];
      fallbackClaims.forEach(fc => {
        if (!mergedClaims.some(c => c.submissionid === fc.submissionid)) {
          mergedClaims.push(fc);
        }
      });

      return sendMappedClaims(mergedClaims);
    } catch (sheetError: any) {
      console.warn("Google Sheets fetch failed, falling back to database/memory storage:", sheetError.message);
      
      // Try Supabase claims fallback first
      try {
        if (supabaseClient) {
          const sbClaims = await getSupabaseClaims();
          if (sbClaims && sbClaims.length > 0) {
            console.log("Fetched claims from Supabase fallback.");
            const mergedClaims = [...sbClaims];
            fallbackClaims.forEach(fc => {
              if (!mergedClaims.some(c => c.submissionid === fc.submissionid)) {
                mergedClaims.push(fc);
              }
            });
            return sendMappedClaims(mergedClaims);
          }
        }
      } catch (sbClaimsErr: any) {
        console.warn("Supabase claims fetch failed:", sbClaimsErr.message);
      }
      
      // 2. Try Firestore claims
      try {
        if (isFirestoreEnabled()) {
          const claimsSnapshot = await db.collection('claims').orderBy('createdAt', 'desc').limit(100).get();
          const dbClaims: any[] = [];
          
          for (const doc of claimsSnapshot.docs) {
            const docData = doc.data();
            const subId = doc.id;
            
            // Try fetching sub-items
            let itemsSnapshot: any;
            try {
              itemsSnapshot = await doc.ref.collection('items').get();
            } catch (ite) {
              itemsSnapshot = { docs: [] };
            }
            const itemsData = itemsSnapshot.docs.map((idoc: any) => idoc.data());
            
            if (itemsData.length === 0) {
              // Create a fallback row-like claim representation
              dbClaims.push({
                rowIndex: 2,
                sheetName: docData.branchName,
                timestamp: docData.createdAt ? formatToIndianTime(docData.createdAt.toDate()) : getIndianTimestamp(),
                submissionid: subId,
                branchname: docData.branchName,
                salespersonname: docData.salespersonName,
                expensecategory: "General",
                itemdate: getIndianDateString(),
                fromlocation: "",
                tolocation: "",
                amount: String(docData.grandTotal),
                attachmentlink: "",
                itemremark: "",
                grandtotal: String(docData.grandTotal),
                adminremark: docData.adminRemark || "",
                mailsent: docData.mailSent ? "Yes" : "No",
                approved: docData.status === "APPROVED" || docData.status === "PROCESSED" || docData.status === "RELEASED" ? "Yes" : "No",
                approvedtimestamp: docData.approvedAt ? formatToIndianTime(docData.approvedAt.toDate()) : "",
                paymentprocess: docData.status === "PROCESSED" || docData.status === "RELEASED" ? "Yes" : "No",
                processedby: docData.processedBy || "",
                status: docData.status,
                paymentrelease: docData.status === "RELEASED" ? "Yes" : "No",
                releasedby: docData.releasedBy || "",
                employeeemail: docData.employeeEmail || ""
              });
            } else {
              itemsData.forEach((item: any, idx: number) => {
                dbClaims.push({
                  rowIndex: idx + 2,
                  sheetName: docData.branchName,
                  timestamp: docData.createdAt ? formatToIndianTime(docData.createdAt.toDate()) : getIndianTimestamp(),
                  submissionid: subId,
                  branchname: docData.branchName,
                  salespersonname: docData.salespersonName,
                  expensecategory: item.category || "General",
                  itemdate: item.itemDate || "",
                  fromlocation: item.fromLoc || "",
                  tolocation: item.toLoc || "",
                  amount: String(item.amount || ""),
                  attachmentlink: item.attachmentLink || "",
                  itemremark: item.remark || "",
                  grandtotal: String(docData.grandTotal),
                  adminremark: docData.adminRemark || "",
                  mailsent: docData.mailSent ? "Yes" : "No",
                  approved: docData.status === "APPROVED" || docData.status === "PROCESSED" || docData.status === "RELEASED" ? "Yes" : "No",
                  approvedtimestamp: docData.approvedAt ? formatToIndianTime(docData.approvedAt.toDate()) : "",
                  paymentprocess: docData.status === "PROCESSED" || docData.status === "RELEASED" ? "Yes" : "No",
                  processedby: docData.processedBy || "",
                  status: docData.status,
                  paymentrelease: docData.status === "RELEASED" ? "Yes" : "No",
                  releasedby: docData.releasedBy || "",
                  employeeemail: docData.employeeEmail || ""
                });
              });
            }
          }
          
          if (dbClaims.length > 0) {
            const mergedClaims = [...dbClaims];
            fallbackClaims.forEach(fc => {
              if (!mergedClaims.some(c => c.submissionid === fc.submissionid)) {
                mergedClaims.push(fc);
              }
            });
            return sendMappedClaims(mergedClaims);
          }
        }
      } catch (firestoreError) {
        console.error("Firestore claims fetch failed:", firestoreError);
      }

      // 3. Complete fallback back to in-memory array
      return sendMappedClaims(fallbackClaims);
    }
  } catch (error: any) {
    console.error("Critical Admin Fetch Error:", error);
    return res.json({ success: true, claims: [] });
  }
});

// 2b. Submit Simple Claim (Flat claimant schema from client-side App.tsx)
app.post("/api/claims", async (req, res) => {
  try {
    const {
      claimDate,
      claimantName,
      claimantEmail,
      title,
      amount,
      category,
      branch,
      description,
      fileBase64,
      fileName,
      branchHeadEmail
    } = req.body;

    const submissionId = 'CLM-' + Math.floor(100000 + Math.random() * 900000);
    const timestamp = getIndianTimestamp();

    let driveClient: any = null;
    try {
      driveClient = await getDriveClient();
    } catch (e: any) {
      console.warn("Google Drive not available for flat submit:", e.message);
    }

    let attachmentUrl = "";
    if (fileBase64 && fileName && driveClient) {
      try {
        attachmentUrl = await uploadToDrive(
          `${submissionId}_${fileName}`,
          fileBase64,
          "application/octet-stream"
        ) || "";
      } catch (uploadError) {
        console.error("Flat upload to Drive failed:", uploadError);
        attachmentUrl = "Upload Failed (Google Drive Error)";
      }
    } else if (fileBase64 && fileName) {
      attachmentUrl = "Attachment Loaded (Local Copy Only)";
    }

    const localRows = [{
      rowIndex: 2,
      sheetName: branch || "Sheet1",
      timestamp,
      submissionid: submissionId,
      branchname: branch || "Sheet1",
      salespersonname: claimantName,
      expensecategory: category,
      itemdate: claimDate,
      fromlocation: "",
      tolocation: "",
      amount: String(amount),
      attachmentlink: attachmentUrl,
      itemremark: description || title,
      grandtotal: String(amount),
      adminremark: "",
      mailsent: "No",
      approved: "No",
      approvedtimestamp: "",
      paymentprocess: "No",
      processedby: "",
      status: "Pending",
      paymentrelease: "No",
      releasedby: "",
      employeeemail: claimantEmail,
      branchheademail: branchHeadEmail
    }];

    // Local file system backup
    fallbackClaims.push(...localRows);
    fallbackEmailMap[submissionId] = claimantEmail;
    saveLocalJSON(CLAIMS_FILE, fallbackClaims);
    saveLocalJSON(MAIL_MAP_FILE, fallbackEmailMap);

    // Sync flat claim to Supabase if config is provided
    try {
      if (supabaseClient) {
        await saveSupabaseClaims(localRows);
      }
    } catch (sbErr) {
      console.error("Supabase Sync Error:", sbErr);
    }

    // Sync flat claim to Firestore
    try {
      if (isFirestoreEnabled()) {
        const claimRef = db.collection('claims').doc(submissionId);
        await claimRef.set({
          submissionId,
          branchName: branch || "Unknown",
          salespersonName: claimantName || "Unknown",
          employeeEmail: claimantEmail,
          grandTotal: Number(amount),
          status: 'PENDING',
          createdAt: getFirebaseServerTimestamp(),
          mailSent: false
        });

        const itemRef = claimRef.collection('items').doc(`item_0`);
        await itemRef.set({
          category,
          itemDate: claimDate,
          fromLoc: "",
          toLoc: "",
          amount: Number(amount),
          attachmentLink: attachmentUrl,
          remark: description || title
        });
      }
    } catch (fsErr) {
      console.error("Firestore Sync Error:", fsErr);
    }

    // Append raw Row to Google Sheet Branch
    try {
      const sheets = await getSheetsClient();
      const sheetTitle = branch || "Sheet1";
      await ensureSheetExists(sheets, SHEET_ID, sheetTitle);
      await saveEmailMapping(sheets, SHEET_ID, submissionId, claimantEmail);

      const rows = [[
        timestamp,
        submissionId,
        branch || "",
        claimantName || "",
        category || "",
        claimDate || "",
        "", // from
        "", // to
        amount || "",
        attachmentUrl || "",
        description || title || "",
        amount || 0,
        "", // Admin Remark
        "No", // Mail Sent
        "No", // Approved
        "", // Approved Timestamp
        "No", // Payment Process
        "", // Processed By
        "Pending", // Status
        "No", // Payment Release
        ""  // Released By
      ]];

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${sheetTitle}!A:U`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });
    } catch (sheetError: any) {
      console.warn("Sheets Append Error:", sheetError.message);
    }

    // Email Dispatch
    try {
      const adminEmailsRaw = process.env.ADMIN_EMAILS || "mis.mumbai@ginzalimited.com";
      const adminsList = adminEmailsRaw.split(",").map(e => e.trim()).filter(Boolean);
      if (!adminsList.includes("mis.mumbai@ginzalimited.com")) {
        adminsList.push("mis.mumbai@ginzalimited.com");
      }
      const adminEmails = adminsList.join(",");
      const recipients = branchHeadEmail ? `${adminEmails},${branchHeadEmail}` : adminEmails;
      
      const emailSubject = `New Claim Submitted - ${claimantName} (${branch})`;
      const emailBody = `Dear Admin,\n\nA new expense claim of ₹${amount} has been successfully submitted by ${claimantName}.\n\n--- Claimant Information ---\nName: ${claimantName}\nEmail: ${claimantEmail}\nBranch: ${branch}\nSubmission ID: ${submissionId}\n\nGoogle Spreadsheet Link:\nhttps://docs.google.com/spreadsheets/d/${SHEET_ID}\n\nPlease click on the review link or log into the Admin portal to manage this claim.`;

      await sendMail(
        recipients,
        "",
        emailSubject,
        emailBody,
        claimantName,
        claimantEmail
      );
    } catch (mailErr) {
      console.error("Safe notification skip on flat submit:", mailErr);
    }

    res.json({
      success: true,
      claim: {
        id: submissionId,
        claimDate,
        submitDate: timestamp,
        claimantName,
        claimantEmail,
        title,
        amount: Number(amount) || 0,
        category,
        branch,
        description,
        attachmentUrl,
        status: "Pending",
        remarks: ""
      }
    });
  } catch (error: any) {
    console.error("Flat submit api failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2c. Flat Claim approval activity action (Approve, Reject, Process, Release from client-side App.tsx)
app.post("/api/claims/action", async (req, res) => {
  try {
    const { id, status, remarks, claimantEmail, title, amount, rowIndex: reqRowIndex, branchName: reqBranchName, adminEmail: reqAdminEmail } = req.body;

    const claim = fallbackClaims.find(c => c.submissionid === id);
    const branchName = reqBranchName || (claim ? claim.branchname : "Sheet1");

    // Dynamic row finder in Google Sheet
    let rowIndex = reqRowIndex || (claim ? Number(claim.rowIndex) : 2);
    try {
      if (id) {
        const sheets = await getSheetsClient();
        const targetSheet = branchName || "Sheet1";
        const sheetValuesResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${targetSheet}!B:B`
        });
        const rows = sheetValuesResponse.data.values || [];
        for (let idx = 0; idx < rows.length; idx++) {
          if (rows[idx] && rows[idx][0] === id) {
            rowIndex = idx + 1; // 1-indexed row number
            console.log(`Dynamic row locator found submission ${id} at row ${rowIndex} in Google Sheet ${targetSheet}`);
            break;
          }
        }
      }
    } catch (rowLocError) {
      console.warn("Dynamic row locator failed:", rowLocError);
    }

    const adminEmail = reqAdminEmail || "mis.mumbai@ginzalimited.com";
    const adminName = getAdminDisplayName(adminEmail);
    const timestamp = getIndianTimestamp();

    let action = "REMARK";
    if (status === "Approved") action = "APPROVE";
    else if (status === "Processed") action = "PROCESS";
    else if (status === "Released") action = "RELEASE";
    else if (status === "Rejected") action = "REMARK";

    const mappedComment = remarks || (action === "APPROVE" ? "Approved" : status);

    // Update in-memory local fallback array
    fallbackClaims = fallbackClaims.map(c => {
      if (c.submissionid === id) {
        const updated = { ...c };
        if (action === "REMARK") {
          updated.adminremark = mappedComment;
          updated.mailsent = "Yes";
          updated.status = "Rejected";
        } else if (action === "APPROVE") {
          updated.approved = "Yes";
          updated.approvedtimestamp = `${adminName} - ${timestamp}`;
          updated.status = "Approved";
          updated.adminremark = mappedComment;
          updated.mailsent = "Yes";
        } else if (action === "PROCESS") {
          updated.paymentprocess = "Yes";
          updated.processedby = `${adminName} - ${timestamp}`;
          updated.status = "Payment Process On Going";
        } else if (action === "RELEASE") {
          updated.paymentrelease = "Yes";
          updated.releasedby = `${adminName} - ${timestamp}`;
          updated.status = "Released";
        }
        return updated;
      }
      return c;
    });
    saveLocalJSON(CLAIMS_FILE, fallbackClaims);

    // Sync action state to Firestore
    try {
      if (isFirestoreEnabled()) {
        const updateData: any = {
          updatedAt: getFirebaseServerTimestamp()
        };
        if (action === "REMARK") {
          updateData.adminRemark = mappedComment;
          updateData.status = "REJECTED";
          updateData.mailSent = true;
        } else if (action === "APPROVE") {
          updateData.status = "APPROVED";
          updateData.approvedAt = getFirebaseServerTimestamp();
          updateData.approvedBy = `${adminName} (${adminEmail})`;
          updateData.adminRemark = mappedComment;
          updateData.mailSent = true;
        } else if (action === "PROCESS") {
          updateData.status = "Payment Process On Going";
          updateData.processedBy = `${adminName} (${adminEmail})`;
          updateData.processedAt = getFirebaseServerTimestamp();
        } else if (action === "RELEASE") {
          updateData.status = "RELEASED";
          updateData.releasedBy = `${adminName} (${adminEmail})`;
          updateData.releasedAt = getFirebaseServerTimestamp();
        }
        await db.collection('claims').doc(id).update(updateData);
      }
    } catch (fsErr) {
      console.error("Firestore action sync error:", fsErr);
    }

    // Sync action state to Supabase
    try {
      if (supabaseClient) {
        const updateFields: any = {};
        if (action === "REMARK") {
          updateFields.adminremark = mappedComment;
          updateFields.mailsent = "Yes";
          updateFields.status = "Rejected";
        } else if (action === "APPROVE") {
          updateFields.approved = "Yes";
          updateFields.approvedtimestamp = `${adminName} - ${timestamp}`;
          updateFields.status = "Approved";
          updateFields.adminremark = mappedComment;
          updateFields.mailsent = "Yes";
        } else if (action === "PROCESS") {
          updateFields.paymentprocess = "Yes";
          updateFields.processedby = `${adminName} - ${timestamp}`;
          updateFields.status = "Payment Process On Going";
        } else if (action === "RELEASE") {
          updateFields.paymentrelease = "Yes";
          updateFields.releasedby = `${adminName} - ${timestamp}`;
          updateFields.status = "Released";
        }
        await updateSupabaseClaim(id, updateFields);
      }
    } catch (sbErr) {
      console.error("Supabase action sync error:", sbErr);
    }

    // Google Sheets live column edits
    try {
      const sheets = await getSheetsClient();
      const targetSheet = branchName || "Sheet1";
      if (action === "REMARK") {
        const range = `${targetSheet}!M${rowIndex}:N${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[mappedComment, "Yes"]] },
        });

        // Column S - Status state
        const statusRange = `${targetSheet}!S${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: statusRange,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Rejected"]] },
        });
      } else if (action === "APPROVE") {
        // Update Column M (Admin Remark), N (Mail Sent), O (Approved), P (Approved Timestamp) all at once
        const range = `${targetSheet}!M${rowIndex}:P${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[mappedComment, "Yes", "Yes", `${adminName} - ${timestamp}`]] },
        });

        // Column S - Status state
        const statusRange = `${targetSheet}!S${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: statusRange,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Approved"]] },
        });
      } else if (action === "PROCESS") {
        // Column Q (Payment Process), R (Processed By), S (Status Log)
        const range = `${targetSheet}!Q${rowIndex}:S${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Yes", `${adminName} - ${timestamp}`, "Payment Process On Going"]] },
        });
      } else if (action === "RELEASE") {
        // Column T (Payment Release), U (Released By)
        const range = `${targetSheet}!T${rowIndex}:U${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Yes", `${adminName} - ${timestamp}`]] },
        });

        // Column S - Status state
        const statusRange = `${targetSheet}!S${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: statusRange,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Released"]] },
        });
      }
    } catch (sheetError: any) {
      console.warn("Sheets action edit bypassed:", sheetError.message);
    }

    // Mail alerts
    try {
      const targetClaimant = claimantEmail || "";
      const bHeadEmail = claim ? claim.branchheademail : "";
      
      const adminEmailsStr = process.env.ADMIN_EMAILS || "mis.mumbai@ginzalimited.com";
      const adminsList = adminEmailsStr.split(",").map(e => e.trim()).filter(Boolean);
      if (!adminsList.includes("mis.mumbai@ginzalimited.com")) {
        adminsList.push("mis.mumbai@ginzalimited.com");
      }
      const adminEmails = adminsList.join(",");

      // Resolve claim detail variables
      const employeeName = claim ? (claim.salespersonname || claim.name || "Employee") : "Employee";
      const employeeEmail = targetClaimant || (claim ? claim.employeeemail : "") || "employee@ginzalimited.com";
      const claimBranch = branchName || (claim ? claim.branchname || claim.branch : "") || "Default";
      const category = claim ? (claim.expensecategory || claim.category || "General") : "General";
      const claimDate = claim ? (claim.itemdate || claim.date || "N/A") : "N/A";
      const expenseTitle = claim ? (claim.itemremark || claim.remark || title || "Expense Claim") : (title || "Expense Claim");
      const claimDescription = claim ? (claim.itemremark || claim.remark || "N/A") : "N/A";
      const attachmentLink = claim ? (claim.attachmentlink || claim.attachment || "") : "";
      const attachmentHtml = attachmentLink ? `<p style="margin-top: 15px;"><strong>Attachment Link:</strong> <a href="${attachmentLink}" style="color: #2563eb; text-decoration: underline;" target="_blank">View Claim Document/Receipt</a></p>` : "";

      // Branch Emails Mapping
      const BRANCH_EMAILS: Record<string, string> = {
        "Ludhiana": "kavita.acharya@ginzalimited.com",
        "Mumbai": "kavita.acharya@ginzalimited.com",
        "Jaipur": "kavita.acharya@ginzalimited.com",
        "Bangalore": "cash.udhna@ginzalimited.com",
        "Surat": "cash.udhna@ginzalimited.com",
        "Tirupur": "cash.udhna@ginzalimited.com"
      };

      const accountsMail = BRANCH_EMAILS[claimBranch] || "cash.udhna@ginzalimited.com";

      if (action === "REMARK") {
        const mailBody = `Dear ${employeeName},\n\nYour claims submission with ID: ${id} (₹${amount}) was Rejected / Remarked by Admin:\n\n"${mappedComment}"\n\nPlease check the portal to update your transactions logs.\n\nThank you,\nExpense Department`;
        await sendMail(
          targetClaimant,
          `${adminEmails},${bHeadEmail}`,
          `REJECTED: Expense Claim Update (${id})`,
          mailBody,
          adminName,
          adminEmail
        );
      } else if (action === "APPROVE") {
        const remarkString = mappedComment && mappedComment !== "Approved" ? `\n\nAdministrative Remarks:\n"${mappedComment}"` : "";
        const mailBody = `Dear ${employeeName},\n\nYour claims submission with ID: ${id} of ₹${amount} was APPROVED successfully by Admin.${remarkString}\n\nApproved Date: ${timestamp}\n\nThank you,\nExpense Department`;
        await sendMail(
          targetClaimant,
          `${adminEmails},${bHeadEmail}`,
          `APPROVED: Expense Claim Update (${id})`,
          mailBody,
          adminName,
          adminEmail
        );
      } else if (action === "PROCESS") {
        const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
  <div style="background-color: #2563eb; color: white; padding: 20px; font-size: 18px; font-weight: bold; text-align: center;">
    PAYMENT PROCESSING REQUEST
  </div>
  <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
    <p>Dear Accounts Team,</p>
    <p>Please process and release the payment for the following approved claim as soon as possible.</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal; width: 40px;">Employee Name:</th>
        <td style="text-align: left; padding: 8px 0; font-weight: bold; color: #0f172a;">${employeeName}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Employee Email:</th>
        <td style="text-align: left; padding: 8px 0; color: #0f172a;">${employeeEmail}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Submitting Branch:</th>
        <td style="text-align: left; padding: 8px 0; color: #0f172a;">${claimBranch}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Claim Category:</th>
        <td style="text-align: left; padding: 8px 0; color: #0f172a;">${category}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Claim Date:</th>
        <td style="text-align: left; padding: 8px 0; color: #0f172a;">${claimDate}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Expense Details:</th>
        <td style="text-align: left; padding: 8px 0; color: #0f172a;">${expenseTitle}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Description / Remark:</th>
        <td style="text-align: left; padding: 8px 0; color: #475569; font-style: italic;">${claimDescription}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Submission ID:</th>
        <td style="text-align: left; padding: 8px 0; font-family: monospace; color: #0f172a;">${id}</td>
      </tr>
      <tr style="border-bottom: 1px solid #cbd5e1; background-color: #f8fafc;">
        <th style="text-align: left; padding: 12px 8px; color: #1e293b; font-weight: bold;">Net Reimbursement:</th>
        <td style="text-align: left; padding: 12px 8px; font-size: 18px; font-weight: 800; color: #2563eb;">₹${Number(amount).toLocaleString('en-IN')}</td>
      </tr>
    </table>

    ${attachmentHtml}

    <div style="margin-top: 24px; padding: 12px; border-left: 4px solid #3b82f6; background-color: #f0f9ff; font-size: 13px; color: #1e40af;">
      <strong>Actioned By:</strong> ${adminName}<br/>
      <strong>Admin Status:</strong> Approved & forwarded to accounts for processing.<br/>
      <strong>Date Authorized:</strong> ${timestamp}
    </div>
    
    <p style="margin-top: 30px; font-size: 12px; color: #94a3b8; text-align: center; border-t: 1px solid #e2e8f0; padding-top: 15px;">
      This is an automated request generated from the Ginza Industries Expense Claim System.
    </p>
  </div>
</div>`;
        await sendMail(
          accountsMail,
          `${employeeEmail},${bHeadEmail},${adminEmails}`,
          `PAYMENT PROCESSING REQUEST: ${id}`,
          htmlBody,
          adminName,
          adminEmail
        );
      } else if (action === "RELEASE") {
        const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
  <div style="background-color: #10b981; color: white; padding: 20px; font-size: 18px; font-weight: bold; text-align: center;">
    PAYMENT RELEASED SUCCESSFULLY 🎉
  </div>
  <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
    <p>Dear ${employeeName},</p>
    <p>We are pleased to inform you that your expense reimbursement payment has been successfully released by the Accounts Department.</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal; width: 40%;">Submission ID:</th>
        <td style="text-align: left; padding: 8px 0; font-family: monospace; color: #0f172a; font-weight: bold;">${id}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Expense Title:</th>
        <td style="text-align: left; padding: 8px 0; color: #0f172a;">${expenseTitle}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <th style="text-align: left; padding: 8px 0; color: #64748b; font-weight: normal;">Expense Category:</th>
        <td style="text-align: left; padding: 8px 0; color: #0f172a;">${category}</td>
      </tr>
      <tr style="border-bottom: 1px solid #cbd5e1; background-color: #f0vdf4;">
        <th style="text-align: left; padding: 12px 8px; color: #1e293b; font-weight: bold;">Amount Reimbursed:</th>
        <td style="text-align: left; padding: 12px 8px; font-size: 18px; font-weight: 800; color: #059669;">₹${Number(amount).toLocaleString('en-IN')}</td>
      </tr>
    </table>

    <div style="margin-top: 24px; padding: 12px; border-left: 4px solid #10b981; background-color: #f0fdf4; font-size: 13px; color: #065f46;">
      <strong>Status:</strong> Released / Paid<br/>
      <strong>Processed By:</strong> Systems Accounts Office (${adminName})<br/>
      <strong>Date of Release:</strong> ${timestamp}
    </div>
    
    <p style="margin-top: 30px; font-size: 12px; color: #94a3b8; text-align: center; border-t: 1px solid #e2e8f0; padding-top: 15px;">
      Please check your registered bank account for the credit of the funds.<br/>
      Thank you for your cooperation!
    </p>
  </div>
</div>`;
        await sendMail(
          employeeEmail,
          `${adminEmails},${bHeadEmail}`,
          `PAYMENT RELEASED: ${id}`,
          htmlBody,
          adminName,
          adminEmail
        );
      }
    } catch (mailErr) {
      console.error("Action email alert skipped:", mailErr);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Flat Action Failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Admin Actions (Remark, Approve, Process, Release)
app.post("/api/admin/action", async (req, res) => {
  const { action, rowIndex, claimId, data, adminName: reqAdminName, adminEmail: reqAdminEmail, sheetName } = req.body;
  const targetSheet = sheetName || "Sheet1";
  const adminEmail = reqAdminEmail || "mis.mumbai@ginzalimited.com";
  const adminName = getAdminDisplayName(adminEmail);
  const timestamp = getIndianTimestamp();

  try {
    // --- 1. LOCAL CACHE MEMORY UPDATE ---
    fallbackClaims = fallbackClaims.map(c => {
      if (c.submissionid === claimId) {
        const updated = { ...c };
        if (action === "REMARK") {
          updated.adminremark = data.remark;
          updated.mailsent = "Yes";
          updated.status = "Remarked";
        } else if (action === "APPROVE") {
          updated.approved = "Yes";
          updated.approvedtimestamp = `${adminName} - ${timestamp}`;
          updated.status = "Approved";
        } else if (action === "PROCESS") {
          updated.paymentprocess = "Yes";
          updated.processedby = `${adminName} - ${timestamp}`;
          updated.status = "Payment Process On Going";
        } else if (action === "RELEASE") {
          updated.paymentrelease = "Yes";
          updated.releasedby = `${adminName} - ${timestamp}`;
          updated.status = "Released";
        }
        return updated;
      }
      return c;
    });
    saveLocalJSON(CLAIMS_FILE, fallbackClaims);

    // --- 2. FIRESTORE UPDATE (Safe Try-Catch) ---
    try {
      if (isFirestoreEnabled()) {
        const updateData: any = {
          updatedAt: getFirebaseServerTimestamp()
        };
        if (action === "REMARK") {
          updateData.adminRemark = data.remark;
          updateData.status = "REMARKED";
          updateData.mailSent = true;
        } else if (action === "APPROVE") {
          updateData.status = "APPROVED";
          updateData.approvedAt = getFirebaseServerTimestamp();
          updateData.approvedBy = `${adminName} (${adminEmail})`;
        } else if (action === "PROCESS") {
          updateData.status = "Payment Process On Going";
          updateData.processedBy = `${adminName} (${adminEmail})`;
          updateData.processedAt = getFirebaseServerTimestamp();
        } else if (action === "RELEASE") {
          updateData.status = "RELEASED";
          updateData.releasedBy = `${adminName} (${adminEmail})`;
          updateData.releasedAt = getFirebaseServerTimestamp();
        }
        await db.collection('claims').doc(claimId).update(updateData);
        console.log(`Firestore synchronized for action ${action} on claim ${claimId}`);
      }
    } catch (fsErr) {
      console.error("Firestore Admin Update Error (non-blocking):", fsErr);
    }

    // --- SUPABASE UPDATE (Safe Try-Catch) ---
    try {
      if (supabaseClient) {
        const updateFields: any = {};
        if (action === "REMARK") {
          updateFields.adminremark = data.remark;
          updateFields.mailsent = "Yes";
          updateFields.status = "Remarked";
        } else if (action === "APPROVE") {
          updateFields.approved = "Yes";
          updateFields.approvedtimestamp = `${adminName} - ${timestamp}`;
          updateFields.status = "Approved";
        } else if (action === "PROCESS") {
          updateFields.paymentprocess = "Yes";
          updateFields.processedby = `${adminName} - ${timestamp}`;
          updateFields.status = "Payment Process On Going";
        } else if (action === "RELEASE") {
          updateFields.paymentrelease = "Yes";
          updateFields.releasedby = `${adminName} - ${timestamp}`;
          updateFields.status = "Released";
        }
        await updateSupabaseClaim(claimId, updateFields);
        console.log(`Supabase synchronized for action ${action} on claim ${claimId}`);
      }
    } catch (sbErr) {
      console.error("Supabase Admin Update Error (non-blocking):", sbErr);
    }

    // --- 3. GOOGLE SHEETS ACCESS (Safe Try-Catch) ---
    try {
      const sheets = await getSheetsClient();
      if (action === "REMARK") {
        // Column M (Admin Remark), N (Mail Sent)
        const range = `${targetSheet}!M${rowIndex}:N${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[data.remark, "Yes"]] },
        });
      } 
      else if (action === "APPROVE") {
        // Column O (Approved), P (Approved Detail)
        const range = `${targetSheet}!O${rowIndex}:P${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Yes", `${adminName} - ${timestamp}`]] },
        });
      }
      else if (action === "PROCESS") {
        // Column Q (Payment Process), R (Processed By), S (Status Log)
        const range = `${targetSheet}!Q${rowIndex}:S${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Yes", `${adminName} - ${timestamp}`, "Payment Process On Going"]] },
        });
      }
      else if (action === "RELEASE") {
        // Column T (Payment Release), U (Released By)
        const range = `${targetSheet}!T${rowIndex}:U${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Yes", `${adminName} - ${timestamp}`]] },
        });

        // Column S - Status state
        const statusRange = `${targetSheet}!S${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: statusRange,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Released"]] },
        });
      }
    } catch (sheetError: any) {
      console.warn("Google Sheets update skipped/failed for Admin Action:", sheetError.message);
    }

    // --- 4. SECURE EMAIL ROUTING ---
    try {
      const claim = fallbackClaims.find(c => c.submissionid === claimId);
      const sName = claim ? claim.salespersonname : (data?.salespersonname || "Employee");
      const sEmail = claim ? (claim.employeeemail || claim.salesperson_email) : (data?.employeeemail || "");
      const bName = claim ? claim.branchname : (data?.branchname || "Sheet1");
      const gTotal = claim ? claim.grandtotal : (data?.grandtotal || "0");
      const bHeadEmail = claim ? claim.branchheademail : (data?.branchheademail || "");
      
      const adminEmailsStr = process.env.ADMIN_EMAILS || "mis.mumbai@ginzalimited.com";
      const adminsList = adminEmailsStr.split(",").map(e => e.trim()).filter(Boolean);
      if (!adminsList.includes("mis.mumbai@ginzalimited.com")) {
        adminsList.push("mis.mumbai@ginzalimited.com");
      }
      const adminEmails = adminsList.join(",");
      
      // Branch Emails Mapping
      const BRANCH_EMAILS: Record<string, string> = {
        "Ludhiana": "kavita.acharya@ginzalimited.com",
        "Mumbai": "kavita.acharya@ginzalimited.com",
        "Jaipur": "kavita.acharya@ginzalimited.com",
        "Bangalore": "cash.udhna@ginzalimited.com",
        "Surat": "cash.udhna@ginzalimited.com",
        "Tirupur": "cash.udhna@ginzalimited.com"
      };

      const accountsMail = BRANCH_EMAILS[bName] || "cash.udhna@ginzalimited.com";

      if (action === "REMARK") {
        await sendMail(
          sEmail, 
          `${adminEmails},${bHeadEmail}`, 
          `Action Required: Expense Claim Update (${claimId})`, 
          `Dear ${sName},\n\nAdmin (${adminName}) has left a remark regarding your claim:\n\n"${data.remark}"\n\nPlease check and respond in the portal.\n\nThank you,\nExpense Department`,
          adminName,
          adminEmail
        );
      } 
      else if (action === "APPROVE") {
        await sendMail(
          sEmail,
          `${adminEmails},${bHeadEmail}`,
          `Claim Approved: ${claimId}`,
          `Dear ${sName},\n\nWe are pleased to inform you that your expense claim of ₹${gTotal} has been APPROVED by ${adminName} and has been forwarded for payment processing.\n\nSubmission ID: ${claimId}\nDate: ${timestamp}`,
          adminName,
          adminEmail
        );
      }
      else if (action === "PROCESS") {
        await sendMail(
          accountsMail,
          `${sEmail},${bHeadEmail},${adminEmails}`,
          `PAYMENT PROCESSING REQUEST: ${sName}`,
          `Dear Accounts Department,\n\nPlease release the payment for the following approved claim:\n\nEmployee: ${sName}\nBranch: ${bName}\nAmount: ₹${gTotal}\nSubmission ID: ${claimId}\n\nApproved By: ${adminName}\nTimestamp: ${timestamp}`,
          adminName,
          adminEmail
        );
      }
      else if (action === "RELEASE") {
        await sendMail(
          sEmail,
          `${adminEmails},${bHeadEmail}`,
          `PAYMENT RELEASED: ${claimId}`,
          `Dear ${sName},\n\nWe are pleased to inform you that your expense claim payment of ₹${gTotal} has been released.\n\nTransaction processed by: ${adminName}\nDate: ${timestamp}`,
          adminName,
          adminEmail
        );
      }
    } catch (mailErr) {
      console.error("Safe notification skip on admin action:", mailErr);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Admin Action Failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Admin Delete Claim from Cache, Firestore, Supabase, and Google Sheets
app.post("/api/admin/claims/delete", async (req, res) => {
  const { claimId, sheetName } = req.body;
  if (!claimId) {
    return res.status(400).json({ success: false, error: "Missing claimId parameter" });
  }

  try {
    console.log(`Received request to delete claim: ${claimId}`);

    // --- 1. LOCAL CACHE MEMORY DELETE ---
    fallbackClaims = fallbackClaims.filter(c => c.submissionid !== claimId);
    saveLocalJSON(CLAIMS_FILE, fallbackClaims);

    // --- 2. SUPABASE DB DELETE ---
    try {
      if (supabaseClient) {
        const { error } = await supabaseClient
          .from("expense_claims")
          .delete()
          .eq("submission_id", claimId);
        if (error) {
          console.error("Supabase delete failure:", error.message);
        } else {
          console.log(`Claim ${claimId} successfully deleted from Supabase.`);
        }
      }
    } catch (sbErr: any) {
      console.error("Supabase delete error (non-blocking):", sbErr.message);
    }

    // --- 3. FIRESTORE DELETE ---
    try {
      if (isFirestoreEnabled()) {
        const claimRef = db.collection('claims').doc(claimId);
        const itemsSnapshot = await claimRef.collection('items').get();
        const batch = db.batch();
        itemsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(claimRef);
        await batch.commit();
        console.log(`Claim ${claimId} deleted from Firestore.`);
      }
    } catch (fsErr: any) {
      console.error("Firestore delete error (non-blocking):", fsErr.message);
      if (fsErr.message && fsErr.message.includes("PERMISSION_DENIED")) {
        const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "your Cloud Run service account";
        console.warn(
          `[Firestore Fix Tip] To fix PERMISSION_DENIED on delete, please ensure that the service account '${saEmail}' has the 'Cloud Datastore User' or 'Cloud Datastore Owner' role assigned in Google Cloud IAM for your project.`
        );
      }
    }

    let sheetsDeletedCount = 0;
    let sheetsWarning = null;

    // --- 4. GOOGLE SHEETS LIVE ROW DELETE ---
    try {
      const sheets = await getSheetsClient();
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
      const sheetsList = spreadsheet.data.sheets || [];

      for (const sheet of sheetsList) {
        const title = sheet.properties?.title;
        const sheetId = sheet.properties?.sheetId;
        if (!title || sheetId === undefined) continue;

        const isMailsSheet = title === "_Mails_";
        
        try {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${title}!A:U`
          });
          const rows = response.data.values || [];
          if (rows.length === 0) continue;

          const matchingIndices: number[] = [];
          let lastSeenClaimId: string | null = null;
          rows.forEach((row: any, idx: number) => {
            if (isMailsSheet) {
              const valToMatch = row[0];
              if (valToMatch && valToMatch.toString().trim() === claimId.toString().trim()) {
                matchingIndices.push(idx + 1);
              }
            } else {
              const valToMatch = row[1];
              if (valToMatch && valToMatch.toString().trim()) {
                lastSeenClaimId = valToMatch.toString().trim();
              }
              const activeClaimId = (valToMatch && valToMatch.toString().trim()) || lastSeenClaimId;
              if (activeClaimId && activeClaimId === claimId.toString().trim()) {
                matchingIndices.push(idx + 1);
              }
            }
          });

          if (matchingIndices.length > 0) {
            console.log(`Found ${matchingIndices.length} matching row(s) to delete in sheet "${title}".`);
            // Sort indices in descending order so that bottom row deletions do not affect top index calculations
            matchingIndices.sort((a, b) => b - a);
            
            const requests = matchingIndices.map(rowIndex => ({
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex - 1,
                  endIndex: rowIndex
                }
              }
            }));

            await sheets.spreadsheets.batchUpdate({
              spreadsheetId: SHEET_ID,
              requestBody: { requests }
            });
            sheetsDeletedCount += matchingIndices.length;
            console.log(`Successfully deleted ${matchingIndices.length} row(s) from sheet "${title}".`);
          }
        } catch (innerErr: any) {
          console.warn(`Could not process sheet "${title}" for deletion:`, innerErr.message);
          sheetsWarning = `Sheet "${title}": ${innerErr.message}`;
        }
      }
    } catch (sheetError: any) {
      console.warn("Google Sheets delete failed/bypassed:", sheetError.message);
      sheetsWarning = sheetError.message;
    }

    res.json({ 
      success: true, 
      message: `Claim ${claimId} has been successfully deleted from internal memory cache, Firestore, and Supabase.`,
      sheetsDeletedCount,
      sheetsWarning
    });
  } catch (error: any) {
    console.error("Admin Delete Action Failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Vite Infrastructure ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;