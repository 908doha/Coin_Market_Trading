/**
 * Strategy Registry
 * src/strategies/ 안의 .js 파일을 자동으로 읽어서
 * agentId → Strategy 클래스 맵을 만든다.
 *
 * 각 전략 파일은 반드시 module.exports.AGENT_IDS 를 선언해야 한다:
 *   class MyStrategy { ... }
 *   module.exports = MyStrategy;
 *   module.exports.AGENT_IDS = ['my-strategy-id'];
 */

const fs   = require('fs');
const path = require('path');

// agentId → Strategy 클래스
const registry    = new Map();
// agentId → { id, name, description, version }
const definitions = new Map();

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && f !== 'index.js');

for (const file of files) {
  const mod  = require(path.join(__dirname, file));
  const defs = mod.AGENT_DEFINITIONS ?? [];
  const ids  = defs.length ? defs.map((d) => d.id) : (mod.AGENT_IDS ?? []);

  for (const id of ids) {
    registry.set(id, mod);
  }
  for (const def of defs) {
    definitions.set(def.id, def);
  }
}

module.exports = { registry, definitions };
