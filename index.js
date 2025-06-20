const express = require('express');
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const fs = require('fs');
const handlebars = require('handlebars');
const path = require('path');
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
  const templatePath = path.join(__dirname, 'templates', `${templateName}.hbs`);
  const source = fs.readFileSync(templatePath, 'utf8');
  const template = handlebars.compile(source);
  return template(data);
}

// Endpoint que envia o email via SES diretamente (sem Nodemailer!)
app.post('/send-email', async (req, res) => {
  const { to, subject, templateData } = req.body;

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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});