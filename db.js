const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: "./database.sqlite"
  },
  useNullAsDefault: true
});

// Cria tabela automaticamente (se ainda não existir)
async function createMeetingsTable() {
  const exists = await knex.schema.hasTable('meetings');
  if (!exists) {
    await knex.schema.createTable('meetings', table => {
      table.increments('id').primary();
      table.string('name');
      table.string('email');
      table.string('phone');
      table.string('date');
      table.string('time');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    console.log('✅ Tabela "meetings" criada com sucesso!');
  }
}

createMeetingsTable();

module.exports = knex;