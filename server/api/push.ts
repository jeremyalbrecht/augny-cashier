import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export default defineEventHandler(async (event) => {
    const credentialsPath = resolve(process.env.GOOGLE_CREDENTIALS_PATH || '');
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
    const body = await readBody(event);
    const { data } = body;

    const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Dettes!A2:D2', // Start appending from the first column
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
            values: [data],
        },
    });

    return { result: response.data };
});
