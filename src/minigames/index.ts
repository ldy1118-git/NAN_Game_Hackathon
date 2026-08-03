import { ChargeBot } from './ChargeBot';
import { ClapBot } from './ClapBot';
import { JumpRope } from './JumpRope';
import { RallyBall } from './RallyBall';
import type { MiniGame } from './MiniGame';

export interface MiniGameEntry {
  id: string;
  title: string;
  hint: string;
  create: () => MiniGame;
}

/**
 * 미니게임 등록소. 새 게임을 만들면 MiniGame 을 구현하고 여기에 한 줄만 추가하면 된다.
 * 시간·판정·점수는 Runner 가 전부 처리하므로 게임 쪽은 그림과 소리만 신경 쓰면 된다.
 */
export const MINIGAMES: MiniGameEntry[] = [
  { id: 'clapbot', title: '따라 치기', hint: new ClapBot().hint, create: () => new ClapBot() },
  { id: 'rallyball', title: '튕겨내기', hint: new RallyBall().hint, create: () => new RallyBall() },
  { id: 'jumprope', title: '줄넘기', hint: new JumpRope().hint, create: () => new JumpRope() },
  { id: 'chargebot', title: '충전하기', hint: new ChargeBot().hint, create: () => new ChargeBot() },
];
