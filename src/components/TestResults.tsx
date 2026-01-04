import { CheckCircle, XCircle, Clock, ListChecks } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface TestResult {
  input: any;
  expected: any;
  actual: any;
  passed: boolean;
  error?: string;
  logs?: string;
}

interface TestResultsProps {
  results: TestResult[];
  executionTime?: number;
}

export function TestResults({ results, executionTime }: TestResultsProps) {
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const allPassed = passedCount === totalCount;

  return (
    <div className="flex flex-col gap-4 h-full">
      <Card className={`p-4 flex-shrink-0 ${allPassed ? 'bg-success/10 border-success/30' : 'bg-card border-border'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${allPassed ? 'bg-success/20' : 'bg-muted'}`}>
              <ListChecks size={20} className={allPassed ? 'text-success' : 'text-muted-foreground'} weight="bold" />
            </div>
            <div>
              <div className="text-sm font-semibold">
                {allPassed ? 'All Tests Passed!' : 'Some Tests Failed'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {passedCount} of {totalCount} test cases passed
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {executionTime !== undefined && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock size={14} />
                <span>{executionTime}ms</span>
              </div>
            )}
            <Badge variant={allPassed ? 'default' : 'destructive'} className={allPassed ? 'bg-success text-success-foreground hover:bg-success/90' : ''}>
              {passedCount} / {totalCount}
            </Badge>
          </div>
        </div>
      </Card>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 pr-4">
          {results.map((result, index) => (
            <Card 
              key={index} 
              className={`p-4 transition-colors ${
                result.passed 
                  ? 'border-success/40 bg-success/5 hover:bg-success/10' 
                  : 'border-destructive/40 bg-destructive/5 hover:bg-destructive/10'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {result.passed ? (
                      <CheckCircle className="text-success flex-shrink-0" size={18} weight="fill" />
                    ) : (
                      <XCircle className="text-destructive flex-shrink-0" size={18} weight="fill" />
                    )}
                    <span className="font-semibold text-sm">
                      Test Case {index + 1}
                    </span>
                  </div>
                  <Badge 
                    variant={result.passed ? 'default' : 'destructive'}
                    className={`text-xs ${result.passed ? 'bg-success/20 text-success hover:bg-success/30 border-success/30' : ''}`}
                  >
                    {result.passed ? 'Passed' : 'Failed'}
                  </Badge>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1.5">Input</div>
                    <pre className="console-output p-3 bg-muted/60 rounded-md overflow-x-auto text-xs border border-border/50">
{JSON.stringify(result.input, null, 2)}
                    </pre>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1.5">Expected</div>
                      <pre className="console-output p-3 bg-muted/60 rounded-md overflow-x-auto text-xs border border-border/50">
{JSON.stringify(result.expected, null, 2)}
                      </pre>
                    </div>
                    
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                        {result.error ? 'Error' : 'Actual'}
                      </div>
                      <pre className={`console-output p-3 rounded-md overflow-x-auto text-xs border ${
                        result.passed 
                          ? 'bg-success/10 border-success/30 text-success-foreground' 
                          : 'bg-destructive/10 border-destructive/30 text-destructive-foreground'
                      }`}>
{result.error ? result.error : JSON.stringify(result.actual, null, 2)}
                      </pre>
                    </div>
                  </div>

                  {result.logs && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1.5">Console Output</div>
                      <pre className="console-output p-3 bg-muted/60 rounded-md overflow-x-auto text-xs border border-border/50">
{result.logs}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
