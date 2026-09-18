import "./App.css";
import AnalysisBoard from "./AnalysisBoard";
import GameBoard from "./GameBoard";

export default function App() {
  const gameData = (window as { gameData?: { mode?: string } }).gameData;
  if (gameData?.mode === "analysis") return <AnalysisBoard />;
  return <GameBoard />;
}
