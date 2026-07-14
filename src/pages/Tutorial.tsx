const TUTORIAL_STEPS = [
  {
    title: "The Goal",
    content: "Mahjong is a game of skill, strategy, and luck. The goal is to be the first player to complete a winning hand: 4 melds + 1 pair (eye). A meld is either a sequence (chi) of three consecutive numbers in the same suit, or a triplet (pung/kong) of three or four identical tiles."
  },
  {
    title: "The Tiles",
    content: "The game uses 136 tiles plus bonus tiles. There are three suits: Bamboo, Characters, and Dots (1-9 each, 4 copies per tile). Honor tiles include the four Winds (East, South, West, North) and three Dragons (Hong/Red, Fa/Green, Baak/White). Bonus tiles include Flowers, Seasons, and Animals."
  },
  {
    title: "Fei (Joker)",
    content: "Fei tiles are jokers that can substitute for ANY tile to complete a hand. They can be used for sequences, pungs, kongs, and the eyes. Fei is not a bonus tile, goes into your hand when drawn, and can never be discarded. Fei cannot be used to call another player’s discard for chi, pung, or kong."
  },
  {
    title: "Dealing",
    content: "Each player starts with 13 tiles (dealer gets 14). The dealer (East) begins by discarding one tile face up to the center. Turn order follows East -> South -> West -> North. The game uses a minimum of 4 tai to win, but this can be configured."
  },
  {
    title: "Drawing and Discarding",
    content: "On your turn, draw a tile from the wall, then discard one tile from your hand face up to the center. You cannot discard Fei tiles. Flower, animal, and kong replacements come from the back of the same wall. The game continues until someone wins, or the wall reaches 15 tiles. If a kong happened in that round and the wall reaches 15, the round ends as a kong round and the dealer passes to the next player."
  },
  {
    title: "Calling Tiles",
    content: "When a player discards, other players may call it:\n\nChi (Sequence): The next player in turn order may take the discard to form a sequence.\n\nPung (Triplet): Any player may take the discard to form a triplet. Pung overrides Chi.\n\nKong (Quad): Any player may take the discard to form a quadruplet.\n\nWin: Any player may take the discard to complete a winning hand."
  },
  {
    title: "Bonuses",
    content: "Drawing a Flower, Season, or Animal tile gives you a replacement draw. Flowers and Seasons matching your seat position also give +1 tai each. Animals give +1 tai each when collected."
  },
  {
    title: "Tai Scoring",
    content: "Tai is the scoring system. Common sources of tai:\n\nWind Pung/Dragon Pung: +1 tai each\nHalf Flush (same suit + honors): +2 tai\nFull Flush (same suit only): +4 tai\nAll Pungs: +3 tai\nBig Three Dragons: +10 tai (automatic win)\nThirteen Wonders: +13 tai (automatic win)\nSelf-Draw: +1 tai\nConcealed Hand: +1 tai\n\nSpecial hands use their own maximum tai and do not stack with smaller pattern bonuses. The minimum tai to win is configurable."
  },
  {
    title: "Winning",
    content: "Win by completing 4 melds + 1 pair. You can win off a discard (someone else's tile completes your hand) or by self-draw (drawing the winning tile yourself). Self-draw gives +1 tai. If you are waiting on an entire suit, that suit's discard cannot be claimed for a win. After winning, the hand is scored and the game resets."
  },
  {
    title: "Tips & Strategy",
    content: "Keep your hand flexible early on. Discard terminal tiles (1, 9) and honors early unless they match your plan. Pay attention to what other players discard. Use Fei strategically for difficult sequences. Watch for half flush opportunities when you have many tiles of one suit."
  }
];

export function Tutorial() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(234,179,8,0.08),_transparent_30%),linear-gradient(180deg,_#0f3d2e_0%,_#09261d_100%)] p-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-yellow-200/80 mb-1">Singapore Mahjong</div>
            <h1 className="text-2xl md:text-3xl font-black text-yellow-200">
              How to Play
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-green-200/80">
              Learn the Singapore Mahjong flow from dealing and calling tiles to Fei usage, tai scoring, wind rotation, and winning hands.
            </p>
          </div>
          <button type="button" onClick={() => navigate('/')} className="text-green-200 hover:text-white underline text-sm">
            Back to Menu
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-green-800/40 backdrop-blur rounded-xl p-4 border border-green-700/30">
            <h2 className="text-lg font-bold text-yellow-300 mb-2">Disclaimer</h2>
            <p className="text-green-200/80 text-sm leading-relaxed">This website is for entertainment and educational purposes only. It is not intended for gambling or real-money play.</p>
            <p className="text-green-200/80 text-sm leading-relaxed mt-2">Mahjong tile images are sourced from publicly available assets and are not owned by the author.</p>
            <p className="text-green-200/80 text-sm leading-relaxed mt-2">Copyright &copy; 2026 sgmahjong.app. All rights reserved.</p>
          </div>
          {TUTORIAL_STEPS.map((step, i) => (
            <div key={i} className="bg-green-800/40 backdrop-blur rounded-xl p-4 border border-green-700/30">
              <h2 className="text-lg font-bold text-green-100 mb-2">
                {i + 1}. {step.title}
              </h2>
              <p className="text-green-200/80 text-sm leading-relaxed whitespace-pre-line">
                {step.content}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 text-center">
          <button type="button" onClick={() => navigate('/')} className="text-green-400 hover:text-green-200 underline text-sm">
            Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}
import { navigate } from '../utils/navigation';
