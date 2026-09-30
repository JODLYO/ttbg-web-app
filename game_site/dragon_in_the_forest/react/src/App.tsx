import "./App.css";
import GameBoard from "./GameBoard";
import VsComputerBoard from "./VsComputerBoard";
import AnalysisBoard from "./AnalysisBoard";

// Which board to render is decided by the Django template that loaded this page (see
// window.gameData in the templates): the live multiplayer game has no `mode`.
export default function App() {
  const mode = (window as unknown as { gameData?: { mode?: string } }).gameData?.mode;
  if (mode === "vs_computer") return <VsComputerBoard />;
  if (mode === "analysis") return <AnalysisBoard />;
  return <GameBoard />;
}
