import { getSheetData } from '~/server/utils/fetch';

export default defineEventHandler(async (event) => {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
    const range = 'Comité!A1:A100'; // Specify the range for Sheet 1
    const { sa } = useRuntimeConfig(event)

    const data = await getSheetData({ spreadsheetId, range, credentialsRaw: sa });

    return { data };
});
