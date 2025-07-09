const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: "./database.sqlite"
  },
  useNullAsDefault: true
});

async function createMeetingsTable() {
  const exists = await knex.schema.hasTable('meetings');
  if (!exists) {
    await knex.schema.createTable('meetings', table => {
      table.increments('id').primary();
      table.string('name');
      table.string('email');
      table.string('phone');
      table.string('pathway_call_id');
      table.string('call_id');
      table.string('issue');
      table.string('goals');
      table.string('task');
      table.string('first_sentence');
      table.string('date');
      table.string('time');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    console.log('✅ Table "meetings" created!');
  }
}

async function createUserProgressTable() {
  const exists = await knex.schema.hasTable('user_progress');
  if (!exists) {
    await knex.schema.createTable('user_progress', table => {
      table.increments('id').primary();
      table.string('email');
      table.string('name');
      table.string('pathway_id');
      table.string('call_id');
      table.string('call_id_voice');
      table.string('current_step');
      table.json('context');
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    console.log('✅ Table "user_progress" created!');
  }
}

createUserProgressTable();

createMeetingsTable();

module.exports = knex;