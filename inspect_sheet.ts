import { google } from "googleapis";
import * as dotenv from "dotenv";
import * as fs from "fs";

// Load .env
dotenv.config();

const getGoogleAuth = async () => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Google Credentials");
  }
  privateKey = privateKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n");

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
};

async function main() {
  try {
    const auth = await (await getGoogleAuth()).getClient();
    const sheets = google.sheets({ version: "v4", auth: auth as any });
    const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1chWoPA4oh7Ss2Xy2jZmUCTDRnmcbDU8L4ojsy46mJh8";
    
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const currentTitles = (spreadsheet.data.sheets || []).map(s => s.properties?.title || "");
    console.log("SHEETS IN SPREADSHEET:", currentTitles);
    
    // Log the columns of each sheet
    for (const title of currentTitles) {
      if (title === "_Mails_" || title === "Sheet1") continue;
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${title}!A1:U5`,
        });
        console.log(`SHEET: ${title} - ROWS COUNT:`, response.data.values?.length || 0);
        if (response.data.values && response.data.values.length > 0) {
          console.log(`FIRST ROW (HEADERS) of ${title}:`, response.data.values[0]);
          console.log(`SECOND ROW of ${title}:`, response.data.values[1]);
        }
      } catch (e: any) {
        console.error(`Error reading sheet ${title}:`, e.message);
      }
    }
  } catch (err) {
    console.error("ERROR", err);
  }
}

main();
