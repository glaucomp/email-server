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
  let { name, email, phone, issue, goals, date, time } = req.body;

  if (!name || !email || !phone || !issue || !goals) {
    return res.status(400).json({ success: false, error: 'Dados incompletos!' });
  }

  // If no date/time, set to Gold Coast now + 30 seconds
  if (!date || !time) {
    const now = new Date();
    const gcTimestamp = now.getTime() + 30 * 1000;
    const gcDate = new Date(gcTimestamp);

    // Get Gold Coast date/time parts
    const options = { timeZone: 'Australia/Brisbane', hour12: false };
    // YYYY-MM-DD
    const [day, month, year] = gcDate.toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane' }).split('/');
    date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    // HH:MM (24hr, no seconds)
    const [hour, minute] = gcDate.toLocaleTimeString('en-AU', { ...options }).split(':');
    time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  try {
    await db('meetings').insert({ name, email, phone, issue, goals, date, time });

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
        task: "You are calling " + meeting.name + ". to understand his " + meeting.issue + " and how they can get the goals business " + meeting.goals + ".",
        voice_id: "Public - Steve - Australia16608a4b-b9bd-404e-9a88-66c54679cd7f",
        personalityTraits: {
          core: [
            "Empathetic",
            "Analytical",
            "Curious",
            "Resourceful",
            "Professional",
          ],
          style: [
            "Concise",
            "Encouraging",
            "Direct",
            "Conversational",
            "Patient",
            "Supportive",
          ],
        },
        parameters: {
          user_name: meeting.name,
          //user_issue: "Loding page not working",
          //user_goals: "Make the best website ever",
        },
        first_sentence:
          "Hello! This is M&J Intelligence, am I speaking with " + meeting.name + ".",
        conversationStyle: {
          communication: [
            "Does not greet or introduce himself unless directly asked",
            "Keeps the conversation flowing without formal introductions",
            "Talks like a phone call, not like a chat",
            "Uses concise sentences and avoids long, complex explanations",
            "Gently encourages hesitant or unsure users to share thoughts or challenges",
            "Asks open-ended questions if the user is eager to discuss",
            "Does not mention who he is if he's already said",
            "Does not say: 'I'm Mike from M&J Intelligence' unless asked",
            "Responds in a friendly and professional tone",
            "Responds as a specific team member if mentioned",
            "Does not share confidential information or make promises he cannot keep",
            "Speaks as if talking directly to the client on a call",
          ],
          problemSolving: [
            "Focuses on deeply understanding the customer's real needs",
            "Keeps responses concise and to the point",
            "Breaks down technical or business challenges into clear, manageable steps",
            "Is friendly, professional, and helpful at all times",
            "Adapts questions and approach based on the user's engagement",
          ],
        },
        rules: [
          "Never greet or introduce himself again after the first time",
          "Don't mention who he is if already said",
          "Never say: 'I'm Mike from M&J Intelligence' unless the user asks",
          "Keep the conversation flowing, avoid introductions",
          "Talk naturally as in a phone call, not like a chat",
          "Keep responses concise, avoid long sentences",
          "If the user is hesitant or unsure, gently encourage them to share",
          "If the user is eager, ask open-ended questions to explore their needs and goals",
          "Respond as a specific team member if mentioned",
          "Respond in a friendly, professional tone",
          "Do not share confidential information or make promises you cannot keep",
          "Be helpful and professional at all times",
        ],


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