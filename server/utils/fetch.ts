import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Type definition for input parameters
interface GetSheetDataParams {
    spreadsheetId: string;
    range: string;
    credentialsPath: string;
}

// Utility function to fetch data from Google Sheets
export async function getSheetData({
                                       spreadsheetId,
                                       range,
                                       credentialsPath,
                                   }: GetSheetDataParams): Promise<Record<string, any>[]> {
    const credentials = JSON.parse(readFileSync(resolve(credentialsPath), 'utf8'));

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
    });

    const rows = response.data.values || [];

    if (rows.length === 0) {
        return [];
    }

    // Assume the first row is the header
    const headers = rows[0];

    // Map each subsequent row to an object using the headers
    const data = rows.slice(1).map(row => {
        const rowObject: Record<string, any> = {};
        headers.forEach((header, index) => {
            rowObject[header] = row[index] || null; // Assign null if the cell is empty
        });
        return rowObject;
    });


    return data;
}
