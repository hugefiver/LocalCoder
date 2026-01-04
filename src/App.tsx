import { useState } from 'react';
import { ProblemList } from '@/components/ProblemList';
import { EditorView } from '@/components/EditorView';
import { ExecutorView } from '@/components/ExecutorView';
import { useKV } from '@github/spark/hooks';

type View = 'list' | 'editor' | 'executor';

function App() {
  const [currentView, setCurrentView] = useState<View>('list');
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null);
  const [solvedProblems, setSolvedProblems] = useKV<number[]>('solved-problems', []);

  const handleSelectProblem = (problemId: number) => {
    setSelectedProblemId(problemId);
    setCurrentView('editor');
  };

  const handleBackToList = () => {
    setCurrentView('list');
    setSelectedProblemId(null);
  };

  const handleOpenExecutor = () => {
    setCurrentView('executor');
  };

  const solvedSet = new Set(solvedProblems || []);

  return (
    <>
      {currentView === 'list' ? (
        <ProblemList 
          onSelectProblem={handleSelectProblem} 
          onOpenExecutor={handleOpenExecutor}
          solvedProblems={solvedSet} 
        />
      ) : currentView === 'executor' ? (
        <ExecutorView onBack={handleBackToList} />
      ) : selectedProblemId !== null ? (
        <EditorView problemId={selectedProblemId} onBack={handleBackToList} />
      ) : null}
    </>
  );
}

export default App;