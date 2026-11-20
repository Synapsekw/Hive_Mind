// A scripted walk through the hive with two people and their agents.
// It uses the real schema and sharing rules in an in-process database, so it
// runs anywhere with `npm run demo`. Nothing is stored afterwards.
import { openDb } from './local-db.mjs';

const { db, as, addUser } = await openDb();
const say = (text = '') => console.log(text);
const step = (text) => console.log(`\n== ${text}`);

const person = (userId) => ({ sub: userId, role: 'authenticated' });
const search = async (who, q) =>
  (await as(who, `select title from public.search_notes($1)`, [q])).map((r) => r.title);
const show = (label, titles) => say(`   ${label}: ${titles.length ? titles.join(', ') : 'nothing'}`);

async function connectAgent(owner, workspace, name) {
  const made = (await as(owner, `select * from public.create_agent($1, $2, 'demo')`, [workspace, name]))[0];
  const login = (await as(null, `select * from public.agent_login($1)`, [made.token]))[0];
  return {
    claims: { sub: login.user_id, role: 'authenticated', agent_id: login.agent_id,
              workspace_id: login.workspace_id, trust_tier: login.trust_tier },
    member: login.member_id, workspace: login.workspace_id, hive: login.hive_id,
  };
}
const write = async (agent, path, title, body) =>
  (await as(agent.claims,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [agent.hive, agent.member, agent.workspace, path, title, body]))[0].id;

step('Dani starts a hive and adds Ahmed');
const dani = person(await addUser('dani@example.com'));
const ahmed = person(await addUser('ahmed@example.com'));
const hive = (await as(dani, `select public.create_hive('Demo hive', 'Dani') as id`))[0].id;
await as(dani, `select public.add_member($1, 'ahmed@example.com', 'Ahmed')`, [hive]);
const wsOf = async (who) => (await as(who, `select id from public.workspaces`))[0].id;
say('   Two members, each with their own private workspace.');

step('Each connects an agent with a token');
const daniAgent = await connectAgent(dani, await wsOf(dani), 'Claude desktop');
const ahmedAgent = await connectAgent(ahmed, await wsOf(ahmed), 'ChatGPT');
say('   Dani: Claude desktop. Ahmed: ChatGPT.');

step('The agents write notes while their people work');
const pricing = await write(daniAgent, 'clients/dmt/pricing.md', 'DMT pricing basis', 'Day rate derives from the DaaS contract.');
const contract = await write(daniAgent, 'clients/dmt/contract.md', 'DMT contract terms', 'Mobilisation terms still open with DMT.');
await write(daniAgent, 'personal/ideas.md', 'Personal ideas', 'Not for the team. Mentions DMT once.');
const visits = await write(ahmedAgent, 'clients/dmt/site-visits.md', 'DMT site visits', 'Both towers inspected. Access windows recorded.');
say('   Dani\'s agent wrote 3 notes, Ahmed\'s wrote 1.');

step('Everything starts private: each agent finds only its own notes');
show('Dani\'s agent searches "DMT"', await search(daniAgent.claims, 'DMT'));
show('Ahmed\'s agent searches "DMT"', await search(ahmedAgent.claims, 'DMT'));

step('Dani\'s agent tries to share a note itself');
try {
  await as(daniAgent.claims, `update public.notes set visibility = 'group' where id = $1`, [pricing]);
  say('   It worked. That is a bug.');
} catch (e) {
  say(`   Refused by the database: "${e.message}"`);
}

step('Dani shares the pricing note with the group, in the app');
await as(dani, `update public.notes set visibility = 'group' where id = $1`, [pricing]);
show('Ahmed\'s agent searches "DMT"', await search(ahmedAgent.claims, 'DMT'));
say('   The contract and the personal note stay hidden.');

step('The hive notices both are working on DMT and proposes a link');
const link = (await db.query(
  `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 1, 1) returning id`,
  [hive, contract, visits])).rows[0].id;
say('   Dani\'s "DMT contract terms" and Ahmed\'s "DMT site visits" are both private.');
show('Ahmed searches "contract"', await search(ahmed, 'contract'));

step('Ahmed accepts. Dani has not yet');
say(`   Link status: ${(await as(ahmed, `select public.respond_to_link($1, true) as s`, [link]))[0].s}`);
show('Ahmed searches "contract"', await search(ahmed, 'contract'));

step('Dani accepts too');
say(`   Link status: ${(await as(dani, `select public.respond_to_link($1, true) as s`, [link]))[0].s}`);
show('Ahmed searches "contract"', await search(ahmed, 'contract'));
show('Dani searches "towers"', await search(dani, 'towers'));

step('What each person can read at the end');
const all = async (who) => (await as(who, `select title from public.notes order by title`)).map((r) => r.title);
show('Dani', await all(dani));
show('Ahmed', await all(ahmed));
show('Someone not signed in', await all(null));
say();
