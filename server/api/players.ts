import { getSheetData } from '~/server/utils/fetch';

export default defineEventHandler(async (event) => {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
    const range = 'Joueurs!A1:C100'; // Specify the range for Sheet 1
    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || '';

    const data = await getSheetData({ spreadsheetId, range, credentialsPath });

    return { data };
});
