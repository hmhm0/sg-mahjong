export function Rules() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-950 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-yellow-300">
            Rules Reference
          </h1>
          <a href="#/" className="text-green-400 hover:text-green-200 underline text-sm">
            Back to Menu
          </a>
        </div>

        <div className="space-y-4">

          <Section title="Tile Set" icon="🎴">
            <p>144 tiles total in a standard set:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Suits</strong> (108 tiles): Bamboo, Characters, Dots - each 1-9, 4 copies per tile</li>
              <li><strong>Winds</strong> (16 tiles): East, South, West, North - 4 copies each</li>
              <li><strong>Dragons</strong> (12 tiles): Hong (Red), Fa (Green), Baak (White) - 4 copies each</li>
              <li><strong>Flowers</strong> (4 tiles): F1-F4</li>
              <li><strong>Seasons</strong> (4 tiles): S1-S4</li>
              <li><strong>Animals</strong> (4 tiles): Cat, Mouse, Rooster, Centipede</li>
              <li><strong>Fei</strong> (configurable, 0-20): Joker tiles, only even numbers</li>
            </ul>
          </Section>

          <Section title="Game Setup" icon="⚙️">
            <ul className="list-disc pl-5 space-y-1">
              <li>4 players, each gets 13 tiles (dealer gets 14)</li>
              <li>Dealer is East, then South, West, North clockwise</li>
              <li>Remaining tiles form the wall (draw pile)</li>
              <li>Can configure minimum tai threshold (0 = any hand wins)</li>
              <li>Can configure number of Fei tiles (0-20, even numbers)</li>
            </ul>
          </Section>

          <Section title="Tai Scoring" icon="⭐">
            <p className="mb-2">Each winning condition awards tai:</p>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['Seat Wind Pung', '+1'],
                  ['Round Wind Pung', '+1'],
                  ['Dragon Pung (any)', '+1 each'],
                  ['Half Flush (same suit + honors)', '+2'],
                  ['Full Flush (same suit only)', '+6'],
                  ['All Pungs (4 triplet melds)', '+3'],
                  ['Little Three Dragons', '+4'],
                  ['Big Three Dragons', '+6'],
                  ['Four Little Winds', '+40 (limit)'],
                  ['Four Great Winds', '+40 (limit)'],
                  ['Self-Draw', '+1'],
                  ['Concealed Hand (no calls)', '+1'],
                  ['Flower/Season matching seat', '+1 each'],
                  ['Fei in hand', '-1 each (penalty)'],
                ].map(([name, tai], i) => (
                  <tr key={i} className="border-b border-green-700/30">
                    <td className="py-1 pr-4 text-green-200">{name}</td>
                    <td className="py-1 text-yellow-300 font-bold text-right">{tai}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-green-300/70 text-xs">
              Total tai must meet or exceed the configured threshold to win.
            </p>
          </Section>

          <Section title="Fei Rules" icon="⭐">
            <ul className="list-disc pl-5 space-y-1">
              <li>Fei tiles act as wild cards for completing sequences ONLY</li>
              <li>Cannot use Fei for pungs or kongs</li>
              <li>When drawn from the wall, Fei goes into your hand (no reveal/replacement)</li>
              <li>Fei tiles cannot be discarded</li>
              <li>Each Fei in hand at winning reduces total tai by 1</li>
              <li>Configurable from 0 to 20 Fei tiles (even numbers only)</li>
            </ul>
          </Section>

          <Section title="Call Priority" icon="📢">
            <p>When a tile is discarded, players can call it in this priority:</p>
            <ol className="list-decimal pl-5 space-y-1 mt-2">
              <li><strong>Win</strong> (any player) - highest priority</li>
              <li><strong>Kong</strong> (any player)</li>
              <li><strong>Pung</strong> (any player) - overrides Chi</li>
              <li><strong>Chi</strong> (next player only)</li>
            </ol>
            <p className="mt-2 text-green-300/70 text-xs">
              If multiple players want the same discard, the highest priority call wins.
              If same priority, the closest player clockwise gets it.
            </p>
          </Section>

          <Section title="Animal Pairs" icon="🐱">

            <ul className="list-disc pl-5 space-y-1">
              <li>Cat (Animal 1) + Mouse (Animal 2): special bonus pair</li>
              <li>Rooster (Animal 3) + Centipede (Animal 4): special bonus pair</li>
              <li>Collecting a matching pair awards additional scoring</li>
            </ul>
          </Section>

          <Section title="Kalong" icon="🔗">
            <p>Kalong (&quot;gap chi&quot;) is when you chi the middle tile of a sequence:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>E.g., holding Bamboo 1 and Bamboo 3, then chi a discarded Bamboo 2</li>
              <li>This creates a sequence with a &quot;gap&quot; in your hand before chi</li>
              <li>Kalong has specific restrictions on winning via Chou Ping Hu (see below)</li>
            </ul>
          </Section>

          <Section title="Ping Hu / Chou Ping Hu" icon="🀫">
            <p><strong>Ping Hu</strong> (平胡 / Common Hand) — A hand consisting of all sequences (chi melds) with no pungs or kongs. The pair (eye) must not be a dragon or a wind tile.</p>
            <p className="mt-2"><strong>Chou Ping Hu</strong> (臭平胡 / Chi Chi Hu / 吃吃胡) — Literally &quot;stinky common hand.&quot; A Ping Hu win where the player has <strong>0 tai</strong> from patterns before scoring (only possible if tai threshold is set to 0).</p>
            <div className="mt-2 p-2 bg-green-900/50 rounded-lg border border-green-700/30">
              <p className="font-bold text-yellow-300 text-xs mb-1">Chou Ping Hu Restrictions:</p>
              <ul className="list-disc pl-5 space-y-1 text-xs">
                <li>A player with <strong>0 tai</strong> (before bonuses) <strong>cannot win</strong> from any other player&apos;s discarded tile for Chou Ping Hu</li>
                <li>They CAN win via <strong>Zi Mo (Self-Draw)</strong> — drawing the winning tile themselves</li>
                <li>Winning from another player&apos;s discard for Chou Ping Hu while waiting for only <strong>one tile</strong> is not allowed</li>
                <li><strong>Dan Diao</strong> (单钓 / single-tile wait): If waiting for one specific tile to complete the pair, you cannot win via Chou Ping Hu even on self-draw</li>
              </ul>
            </div>
          </Section>

          <Section title="Kong" icon="🀄">
            <ul className="list-disc pl-5 space-y-1">
              <li>Can declare kong when you have 4 identical tiles</li>
              <li><strong>Self-kong</strong>: draw all 4 yourself, declare as concealed kong</li>
              <li><strong>Melded kong</strong>: claim a discard with 3 matching tiles in hand</li>
              <li><strong>After kong</strong>: draw one replacement tile from the back of the wall, then discard</li>
              <li>Kong counts as a meld but uses 4 tiles instead of 3</li>
            </ul>
          </Section>

          <Section title="Bite / Yao (杠上开花)" icon="🎯">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Bite (Yao)</strong>: Winning from a kong replacement draw</li>
              <li>When a player makes a kong and draws the replacement tile, if that tile completes their hand, it&apos;s a self-draw win called Yao</li>
              <li>When another player wins from a tile discarded after a kong, it&apos;s also a form of Bite win</li>
              <li>In both cases, the winning player must still meet the minimum tai threshold</li>
            </ul>
          </Section>

          <Section title="Dealer Rotation" icon="🪙">
            <ul className="list-disc pl-5 space-y-1">
              <li>The <strong>dealer (庄 / Zeng)</strong> is always the East wind player</li>
              <li>Dealer is indicated by a gold coin badge with 庄 beside their name</li>
              <li><strong>Dealer wins</strong> → dealer stays for the next round</li>
              <li><strong>Non-dealer wins</strong> → dealer badge passes to the player on the dealer&apos;s right</li>
              <li><strong>Draw game</strong> (wall empty) → dealer passes to the right</li>
              <li><strong>Skip dice roll</strong> on subsequent rounds — the game automatically assigns the correct dealer</li>
            </ul>
          </Section>

          <Section title="Winning" icon="🏆">
            <p>A winning hand consists of <strong>4 melds + 1 pair (eye)</strong>.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Win from discard</strong>: Another player&apos;s discarded tile completes your hand</li>
              <li><strong>Self-Draw (Zi Mo / 自摸)</strong>: Draw the winning tile yourself from the wall (+1 tai)</li>
              <li><strong>Bite / Yao</strong>: Win from a kong replacement draw</li>
              <li>Must meet minimum <strong>tai threshold</strong> (configurable from 1-10)</li>
              <li>With <strong>0 tai</strong>: Can only win via Self-Draw (Chou Ping Hu restriction)</li>
              <li><strong>Wall exhaustion</strong> = draw game (no winner, dealer rotates)</li>
            </ul>
            <div className="mt-2 p-2 bg-green-900/50 rounded-lg border border-green-700/30">
              <p className="font-bold text-yellow-300 text-xs mb-1">Win Restrictions:</p>
              <ul className="list-disc pl-5 space-y-1 text-xs">
                <li>0 tai at start of turn → cannot win from another player&apos;s discard (must self-draw)</li>
                <li>Chou Ping Hu with single-tile wait → cannot win from discard</li>
                <li>Dan Diao (single-tile wait for the eye) → cannot win as Ping Hu even on self-draw</li>
              </ul>
            </div>
          </Section>

          <Section title="Glossary" icon="📖">
            <table className="w-full text-xs">
              <tbody>
                {[
                  ['Chi', 'Call a discard to form a sequence (3 consecutive numbers, same suit)'],
                  ['Pung', 'Call a discard to form a triplet (3 identical tiles)'],
                  ['Kong', 'Call a discard to form a quadruplet (4 identical tiles)'],
                  ['Zi Mo (Self-Draw)', 'Draw your own winning tile from the wall'],
                  ['Hu / Win', 'Complete a winning hand and declare victory'],
                  ['Tai', 'Scoring unit (equivalent to &quot;fan&quot; in other variants)'],
                  ['Fei', 'Joker tile — wild card for sequences only'],
                  ['Kalong', 'Chi the middle tile of a sequence (e.g., 1-3 chi 2)'],
                  ['Ping Hu', 'Common hand — all sequences, no pungs/kongs'],
                  ['Chou Ping Hu', '&quot;Stinky common hand&quot; — Ping Hu with 0 tai from patterns'],
                  ['Dan Diao', 'Single-tile wait — waiting for one specific tile to complete the pair'],
                  ['Bite / Yao', 'Win from a kong replacement draw'],
                  ['Zeng / Dealer (庄)', 'East wind player — deals first, gets 14 tiles'],
                  ['Animal Pairs', 'Cat+Mouse and Rooster+Centipede give bonus scoring'],
                ].map(([term, def], i) => (
                  <tr key={i} className="border-b border-green-700/20">
                    <td className="py-1 pr-3 text-yellow-300 font-bold align-top whitespace-nowrap">{term}</td>
                    <td className="py-1 text-green-200">{def}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>

        <div className="mt-6 text-center">
          <a href="#/" className="text-green-400 hover:text-green-200 underline text-sm">
            Back to Menu
          </a>
        </div>
      </div>
    </div>
  );
}
