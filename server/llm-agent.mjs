// Claude 기반 공장 운영 에이전트 (서버) — 프롬프트·도구·검증·턴 루프는 브라우저와 같이 쓰는 js/agentcore.js에 있다.
// 여기서는 Anthropic SDK 클라이언트로 한 턴을 돌린다.
import { runAgentTurn as runCore, MODEL } from '../js/agentcore.js';

export { MODEL };

/**
 * 한 번의 에이전트 턴을 실행한다.
 * @returns {{ text, actions, rejected, usage, costUSD, model, stopReason }}
 */
export const runAgentTurn = (client, payload) => runCore((params) => client.beta.messages.create(params), payload);
