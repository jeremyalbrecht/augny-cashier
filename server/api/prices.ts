import { getSheetData } from '~/server/utils/fetch';

export default defineEventHandler(async (event) => {
    const { sa } = useRuntimeConfig(event)
    const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
    const range = 'Tarifs!A1:C100'; // Specify the range for Sheet 1

    const data = await getSheetData({ spreadsheetId, range, credentialsRaw: sa });

    return { data };
});
