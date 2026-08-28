export const PYODIDE_BRIDGE_GLOBALS = Object.freeze({
  source: "__localcoder_source_json",
  input: "__localcoder_input_json",
  mode: "__localcoder_mode_json",
});

// This program is deliberately constant. User source and input cross the JS/Python
// boundary only as JSON strings stored in Pyodide globals.
export const PYODIDE_BRIDGE_PROGRAM = `
import json as __localcoder_json
import sys as __localcoder_sys
from io import StringIO as __localcoder_StringIO

def __localcoder_bridge_run():
    __localcoder_stdout = __localcoder_StringIO()
    __localcoder_stderr = __localcoder_StringIO()
    __localcoder_original_stdout = __localcoder_sys.stdout
    __localcoder_original_stderr = __localcoder_sys.stderr
    try:
        __localcoder_sys.stdout = __localcoder_stdout
        __localcoder_sys.stderr = __localcoder_stderr
        __localcoder_source = __localcoder_json.loads(__localcoder_source_json)
        __localcoder_input = __localcoder_json.loads(__localcoder_input_json)
        __localcoder_mode = __localcoder_json.loads(__localcoder_mode_json)
        __localcoder_namespace = {'__name__': '__main__'}
        exec(__localcoder_source, __localcoder_namespace)
        if __localcoder_mode == 'judge':
            __localcoder_solution = __localcoder_namespace.get('solution')
            if not callable(__localcoder_solution):
                raise NameError('Python source must define solution(input)')
            __localcoder_value = __localcoder_solution(__localcoder_input)
        else:
            __localcoder_value = None
    except SyntaxError as __localcoder_error:
        return __localcoder_json.dumps({
            'ok': False,
            'kind': 'python-compile-error',
            'details': f'{type(__localcoder_error).__name__}: {__localcoder_error}',
            'stdout': __localcoder_stdout.getvalue(),
            'stderr': __localcoder_stderr.getvalue(),
        }, ensure_ascii=False, allow_nan=False)
    except BaseException as __localcoder_error:
        return __localcoder_json.dumps({
            'ok': False,
            'kind': 'python-runtime-error',
            'details': f'{type(__localcoder_error).__name__}: {__localcoder_error}',
            'stdout': __localcoder_stdout.getvalue(),
            'stderr': __localcoder_stderr.getvalue(),
        }, ensure_ascii=False, allow_nan=False)
    finally:
        __localcoder_sys.stdout = __localcoder_original_stdout
        __localcoder_sys.stderr = __localcoder_original_stderr

    try:
        __localcoder_value = __localcoder_json.loads(
            __localcoder_json.dumps(__localcoder_value, ensure_ascii=False, allow_nan=False)
        )
    except (TypeError, ValueError) as __localcoder_error:
        return __localcoder_json.dumps({
            'ok': False,
            'kind': 'json-bridge-error',
            'details': f'{type(__localcoder_error).__name__}: {__localcoder_error}',
            'stdout': __localcoder_stdout.getvalue(),
            'stderr': __localcoder_stderr.getvalue(),
        }, ensure_ascii=False, allow_nan=False)

    return __localcoder_json.dumps({
        'ok': True,
        'value': __localcoder_value,
        'stdout': __localcoder_stdout.getvalue(),
        'stderr': __localcoder_stderr.getvalue(),
    }, ensure_ascii=False, allow_nan=False)

__localcoder_bridge_run()
`;
