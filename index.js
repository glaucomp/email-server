const express = require('express');
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const fs = require('fs');
const handlebars = require('handlebars');
const path = require('path');
const db = require('./db');
const moment = require('moment-timezone');
const cron = require('node-cron');
const axios = require('axios');
const { coreArray, styleArray, communicationArray, problemSolvingArray, rulesArray, taskString, firstSentenceString,
  firstSentenceStringAgent } = require('./datas');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(cors());

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
    console.error("Error rendering template:", error);
    throw new Error('Error rendering template:');
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

    res.json({ success: true, message: 'E-mail sent successfully' });
  } catch (err) {
    console.error('Error sending email', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/schedule-meeting', async (req, res) => {
  let { id, name, email, phone, issue, goals, date, time } = req.body;

  if (!name || !phone || !issue || !goals) {
    return res.status(400).json({ success: false, error: 'Missing data' });
  }

  const now = new Date();
  const shouldCallNow = !date || !time;

  if (!date) date = now.toISOString().split("T")[0];
  if (!time) time = now.toTimeString().split(" ")[0].slice(0, 5);

  const task = taskString.replace('#@NAME#@', name)
    .replace('#@ISSUE#@', issue)
    .replace('#@GOALS#@', goals);

  const first_sentence = firstSentenceString.replace('#@NAME#@', name);

  try {
    let meetingId;
    if (id) {
      // UPDATE
      await db('meetings')
        .where({ id })
        .update({
          name, email, phone, issue, goals, date, time, task, first_sentence
        });
      meetingId = id;
    } else {
      const inserted = await db('meetings').insert({
        name, email, phone, issue, goals, date, time, task, first_sentence
      });
      // SQLite retorna um array de IDs
      meetingId = Array.isArray(inserted) ? inserted[0] : inserted;
    }

    if (shouldCallNow) {
      const axiosResponse = await axios.post('https://api.bland.ai/v1/calls', {
        phone_number: phone,
        task: task,
        voice_id: "Public - Steve - Australia16608a4b-b9bd-404e-9a88-66c54679cd7f",
        personalityTraits: {
          core: coreArray,
          style: styleArray,
        },
        parameters: {
          user_name: name,
        },
        first_sentence:
          first_sentence,
        conversationStyle: {
          communication: communicationArray,
          problemSolving: problemSolvingArray,
        },
        rules: rulesArray,
        reduce_latency: true,
        ivr_mode: true,
      }, {
        headers: { 'authorization': process.env.BLAND_AI_AUTH_KEY }
      });
      const call_id = axiosResponse.data.call_id;
      await db('meetings').where({ id: meetingId }).update({ call_id });

      return res.json({ success: true, message: 'Calling now!', call_id, meeting_id: meetingId });
    }

    return res.json({
      success: true,
      message: shouldCallNow ? 'Calling now' : id ? 'Meeting updated successfully!' : 'Meeting scheduled successfully!',
    });

  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/meeting-agent', async (req, res) => {
  let { id, pathway_call_id, phone, agent, call_id, user_name } = req.body;

  if (!phone || !agent) {
    return res.status(400).json({ success: false, error: 'Missing data' });
  }

  const existing = await db('user_progress').where({ call_id }).first();
  console.log('existing ', existing);
  console.log('variable ', existing?.context ? JSON.parse(existing.context).variables : {});


  const axiosResponse = await axios.post('https://api.bland.ai/v1/calls', {
    phone_number: phone,
    //task: task,
    request_data: { "user_phone_number": phone, "user_email": existing.email, "agent_name": agent.name, "user_name": user_name },
    background_track: "office",
    pathway_id: pathway_call_id,
    voice: agent.voice_id,
    personalityTraits: {
      core: coreArray,
      style: styleArray,
    },
    //first_sentence:
    //first_sentence,
    conversationStyle: {
      communication: communicationArray,
      problemSolving: problemSolvingArray,
    },
    rules: rulesArray,
    reduce_latency: true,
    ivr_mode: false,
  }, {
    headers: { 'authorization': process.env.BLAND_AI_AUTH_KEY }
  });
  console.log('axiosResponse', axiosResponse.data);
  const call_id_voice = axiosResponse.data.call_id;

  return res.json({ success: true, message: 'Calling now!', call_id_voice });
});


app.get('/meetings', async (req, res) => {
  try {
    const meetings = await db('meetings').select('*');
    res.json({ success: true, meetings });
  } catch (err) {
    console.error('Error searching meeting', err);
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
        task: meeting.task,
        voice_id: "Public - Steve - Australia16608a4b-b9bd-404e-9a88-66c54679cd7f",
        personalityTraits: {
          core: coreArray,
          style: styleArray,
        },
        parameters: {
          user_name: meeting.name,
        },
        first_sentence:
          meeting.first_sentence,
        conversationStyle: {
          communication: communicationArray,
          problemSolving: problemSolvingArray,
        },
        rules: rulesArray,
        reduce_latency: true,
        ivr_mode: true,

      }, {
        headers: { 'authorization': process.env.BLAND_AI_AUTH_KEY }
      });

      console.log(
        `📞 Automatic call sent to ${meeting.phone} às ${goldCoastNow}`
      );
    }
  } catch (error) {
    console.error("Erro ao disparar ligação automática:", error);
  }
});

app.post('/user-progress', async (req, res) => {
  const { current_step, context, call_id, call_id_voice, pathway_id, email, name } = req.body;

  try {
    const existing = await db('user_progress').where({ call_id }).first();

    if (existing) {
      let oldContext = {};
      try {
        oldContext = existing.context ? JSON.parse(existing.context) : {};
      } catch (e) { }

      const mergedVariables = {
        ...(oldContext.variables || {}),
        ...((context && context.variables) || {}),
      };

      const newContext = {
        ...oldContext,
        ...context,
        variables: mergedVariables,
      };

      await db("user_progress")
        .where({ call_id })
        .update({
          current_step,
          email: email || existing.email,
          name: name || existing.name || context?.variables?.user_name,
          context: JSON.stringify(newContext),
          call_id_voice: call_id_voice || existing.call_id_voice,
          pathway_id: pathway_id || existing.pathway_id,
          updated_at: db.fn.now(),
        });

      res.json({
        status: "updated",
        id: existing.id,
        call_id,
        current_step,
        context: newContext,
      });
    } else {
      // Insert new record
      const [id] = await db('user_progress').insert({
        call_id,
        email,
        name,
        current_step,
        context: JSON.stringify(context || {}),
        call_id_voice,
      });
      res.json({ status: 'inserted', id, call_id, current_step, context });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error save user_progress' });
  }
});

app.patch('/user-progress/:call_id', async (req, res) => {
  const { call_id } = req.params;
  const { call_id_voice } = req.body;

  if (!call_id_voice) {
    return res.status(400).json({ error: "call_id_voice is required" });
  }

  try {
    const updated = await db('user_progress')
      .where({ call_id })
      .update({
        call_id_voice,
        updated_at: db.fn.now(),
      });

    if (updated) {
      res.json({ status: "call_id_voice updated", call_id, call_id_voice });
    } else {
      res.status(404).json({ error: "user_progress not found for this call_id" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar call_id_voice' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});