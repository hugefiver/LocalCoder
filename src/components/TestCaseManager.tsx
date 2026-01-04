import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

interface TestCase {
  input: any;
  expected: any;
}

interface TestCaseManagerProps {
  defaultTestCases: TestCase[];
  customTestCases: TestCase[];
  onCustomTestCasesChange: (testCases: TestCase[]) => void;
}

export function TestCaseManager({ 
  defaultTestCases, 
  customTestCases, 
  onCustomTestCasesChange 
}: TestCaseManagerProps) {
  const [newInput, setNewInput] = useState('');
  const [newExpected, setNewExpected] = useState('');

  const handleAddTestCase = () => {
    if (!newInput.trim() || !newExpected.trim()) {
      toast.error('Please provide both input and expected output');
      return;
    }

    try {
      const inputObj = JSON.parse(newInput);
      const expectedObj = JSON.parse(newExpected);
      
      onCustomTestCasesChange([...customTestCases, { input: inputObj, expected: expectedObj }]);
      setNewInput('');
      setNewExpected('');
      toast.success('Test case added');
    } catch (error) {
      toast.error('Invalid JSON format');
    }
  };

  const handleRemoveTestCase = (index: number) => {
    onCustomTestCasesChange(customTestCases.filter((_, i) => i !== index));
    toast.success('Test case removed');
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 pr-4">
        <div>
          <h3 className="text-sm font-semibold mb-3">Default Test Cases</h3>
          <div className="space-y-2">
            {defaultTestCases.map((testCase, index) => (
              <Card key={index} className="p-3 bg-card/50">
                <div className="space-y-2">
                  <div className="font-medium text-xs text-muted-foreground">Test Case {index + 1}</div>
                  <div>
                    <span className="text-muted-foreground text-xs">Input:</span>
                    <pre className="console-output mt-1 p-2 bg-muted/50 rounded overflow-x-auto text-xs">
                      {JSON.stringify(testCase.input, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Expected:</span>
                    <pre className="console-output mt-1 p-2 bg-muted/50 rounded overflow-x-auto text-xs">
                      {JSON.stringify(testCase.expected, null, 2)}
                    </pre>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {customTestCases.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Custom Test Cases</h3>
            <div className="space-y-2">
              {customTestCases.map((testCase, index) => (
                <Card key={index} className="p-3 bg-primary/5 border-primary/20">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-xs text-muted-foreground">
                        Custom Test {index + 1}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveTestCase(index)}
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash size={14} />
                      </Button>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Input:</span>
                      <pre className="console-output mt-1 p-2 bg-muted/50 rounded overflow-x-auto text-xs">
                        {JSON.stringify(testCase.input, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Expected:</span>
                      <pre className="console-output mt-1 p-2 bg-muted/50 rounded overflow-x-auto text-xs">
                        {JSON.stringify(testCase.expected, null, 2)}
                      </pre>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-3">Add Custom Test Case</h3>
          <Card className="p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Input (JSON format)
              </label>
              <Textarea
                value={newInput}
                onChange={(e) => setNewInput(e.target.value)}
                placeholder='{"nums": [1, 2, 3], "target": 5}'
                className="font-mono text-xs min-h-[80px] resize-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Expected Output (JSON format)
              </label>
              <Textarea
                value={newExpected}
                onChange={(e) => setNewExpected(e.target.value)}
                placeholder='[0, 2]'
                className="font-mono text-xs min-h-[80px] resize-none"
              />
            </div>
            <Button onClick={handleAddTestCase} className="w-full gap-2" size="sm">
              <Plus size={16} weight="bold" />
              Add Test Case
            </Button>
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
}
