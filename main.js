require('dotenv').config();
const { google } = require('googleapis');
const fetch = require('node-fetch');
const Papa = require('papaparse');
const cron = require('node-cron');
const fs = require('fs');

const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CLIENT_SECRET);
const { client_secret, client_id } = credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);

const TOKEN_PATH = 'token.json';

fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client);
    oAuth2Client.setCredentials(JSON.parse(token));
    console.log('Token cargado desde', TOKEN_PATH);
});

function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    console.log('Autoriza la aplicación visitando esta URL:', authUrl);
    
    const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('Ingresa el código de autorización que aparece en la página: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error al intentar recuperar el token de acceso', err);
            oAuth2Client.setCredentials(token);
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token guardado en', TOKEN_PATH);
            });
        });
    });
}

async function clearSheet(spreadsheetId) {
    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SHEETS_CARBON),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const range = `${process.env.SHEET_NAME}!A:Z`;

    const request = {
        spreadsheetId: spreadsheetId,
        range,
    };

    try {
        const response = await sheets.spreadsheets.values.clear(request);
        console.log(`Hoja ${process.env.SHEET_NAME} limpiada.`);
        return response;
    } catch (err) {
        console.error('Error al limpiar la hoja de cálculo:', err);
        throw err;
    }
}

async function updateGoogleSheet(spreadsheetId, csvData) {
    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SHEETS_CARBON),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const range = `${process.env.SHEET_NAME}!A1`;

    await clearSheet(spreadsheetId);

    Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        complete: async function(results) {
            let dataArray = [results.meta.fields];
            results.data.forEach(row => {
                let rowArray = [];
                results.meta.fields.forEach(field => {
                    rowArray.push(row[field] || '');
                });
                dataArray.push(rowArray);
            });
            const request = {
                spreadsheetId: spreadsheetId,
                range,
                valueInputOption: 'RAW',
                resource: {
                    values: dataArray,
                },
            };

            try {
                const response = await sheets.spreadsheets.values.update(request);
                console.log(`${response.data.updatedCells} celdas actualizadas.`);
            } catch (err) {
                console.error('Error actualizando la hoja de cálculo:', err);
            }
        },
        error: function(error) {
            console.error('Error al parsear CSV:', error);
        }
    });
}

async function fetchDataAndUpdateSheet() {
    const url = process.env.FECH_URL;

    const options = {
        method: 'get',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        }
    };

    try {
        const response = await fetch(url, options);
        if (response.status === 200) {
            const csv = await response.text();
            await updateGoogleSheet(process.env.SPREADSHEET_ID, csv);
        } else {
            console.error("Error: " + response.status);
        }
    } catch (error) {
        console.error("Error al realizar el fetch:", error);
    }
}

cron.schedule('0 5 * * *', () => {
    console.log('Ejecutando cron job...');
    fetchDataAndUpdateSheet();
});

console.log('Cron job programado. Esperando...');