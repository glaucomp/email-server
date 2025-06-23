const express = require('express');
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const fs = require('fs');
const handlebars = require('handlebars');
const path = require('path');
const db = require('./db');
const moment = require('moment-timezone');
const cron = require('node-cron');
const axios = require('axios');

require('dotenv').config();

const app = express();
app.use(express.json());

const sesClient = new SESv2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY
  }
});

// Renderizar template Handlebars
function renderTemplate(templateName, data) {
  try {
    const templatePath = path.join(__dirname, 'templates', `${templateName}.hbs`);
    const source = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(source);
    return template(data);
  } catch (error) {
    console.error("Error renderizando o template do email:", error);
    throw new Error('Error renderizando o template do email');
  }
}

app.post('/send-email', async (req, res) => {
  const { to, subject, templateData } = req.body;

  if (!to || !subject || !templateData) {
    return res
      .status(400)
      .json({
        success: false,
        error: "Missing required fields: (to, subject, templateData)",
      });
  }

  try {
    const html = renderTemplate('email', templateData);

    const params = {
      FromEmailAddress: process.env.FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: {
            Html: { Data: html }
          }
        }
      }
    };

    const command = new SendEmailCommand(params);
    await sesClient.send(command);

    res.json({ success: true, message: 'E-mail enviado diretamente com SES!' });
  } catch (err) {
    console.error('Erro ao enviar email:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/schedule-meeting', async (req, res) => {
  const { name, email, phone, date, time } = req.body;

  if (!name || !email || !phone || !date || !time) {
    return res.status(400).json({ success: false, error: 'Dados incompletos!' });
  }

  try {
    await db('meetings').insert({ name, email, phone, date, time });

    res.json({ success: true, message: 'Reunião agendada com sucesso!' });
  } catch (err) {
    console.error('Erro ao agendar reunião:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/meetings', async (req, res) => {
  try {
    const meetings = await db('meetings').select('*');
    res.json({ success: true, meetings });
  } catch (err) {
    console.error('Erro ao consultar reuniões:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


cron.schedule('* * * * *', async () => {
  const goldCoastNow = moment().tz('Australia/Brisbane').format('YYYY-MM-DD HH:mm');

  const [date, time] = goldCoastNow.split(' ');

  try {
    const meetings = await db('meetings').where({ date, time });

    for (const meeting of meetings) {
      await axios.post('https://api.bland.ai/v1/calls', {
        phone_number: meeting.phone,
        pathway_id: "6ae16af7-5d44-4076-a8c5-077f293118dd",
        parameters: {
          user_name: meeting.name,
          user_issue: "Loding page not working",
          user_goals: "Make the best website ever",
        }
      }, {
        headers: { 'authorization': 'org_59adf6eb9c336d5be2ccda75d51bcefd6a922df6d64331944a6461d65212163ae252eb919984110be7e969' }
      });

      console.log(
        `📞 Automatic call sent to ${meeting.phone} às ${goldCoastNow}`
      );
    }
  } catch (error) {
    console.error("Erro ao disparar ligação automática:", error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});