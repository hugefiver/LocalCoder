use std::io::{self, Read};

use rustpython::{InterpreterBuilder, InterpreterBuilderExt};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Execute,
    Judge,
}

#[derive(Debug, Deserialize)]
struct Request {
    mode: Mode,
    source: String,
    input: Option<Value>,
}

fn emit(value: Value) {
    println!(
        "{}",
        serde_json::to_string(&value).expect("runner response is JSON")
    );
}

fn failure(kind: &str, details: impl Into<String>) {
    emit(json!({
        "ok": false,
        "kind": kind,
        "details": details.into(),
        "stdout": "",
        "stderr": "",
    }));
}

fn mode_name(mode: &Mode) -> &'static str {
    match mode {
        Mode::Execute => "execute",
        Mode::Judge => "judge",
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        encoded.push(ALPHABET[(first >> 2) as usize] as char);
        encoded.push(ALPHABET[(((first & 0b0000_0011) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            ALPHABET[(((second & 0b0000_1111) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            ALPHABET[(third & 0b0011_1111) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

fn bridge_program(request: &Request) -> Result<String, serde_json::Error> {
    let carrier = base64_encode(&serde_json::to_vec(&json!({
        "mode": mode_name(&request.mode),
        "source": request.source,
        "input": request.input,
    }))?);
    Ok(format!(
        r#"import base64
from _io import StringIO
import json
import sys

_payload = json.loads(base64.b64decode("{carrier}").decode("utf-8"))
_namespace = {{"__name__": "__main__"}}
_captured_stdout = StringIO()
_captured_stderr = StringIO()
_old_stdout, _old_stderr = sys.stdout, sys.stderr
_result = None
_failure = None

try:
    sys.stdout, sys.stderr = _captured_stdout, _captured_stderr
    _compiled = compile(_payload["source"], "<localcoder>", "exec")
    exec(_compiled, _namespace)
    if _payload["mode"] == "judge":
        _solution = _namespace.get("solution")
        if not callable(_solution):
            raise TypeError("judge source must define callable solution(input)")
        _result = _solution(_payload.get("input"))
except SyntaxError as _error:
    _failure = {{"kind": "python-compile-error", "details": repr(_error)}}
except BaseException as _error:
    _failure = {{"kind": "python-runtime-error", "details": repr(_error)}}
finally:
    sys.stdout, sys.stderr = _old_stdout, _old_stderr

_stdout = _captured_stdout.getvalue()
_stderr = _captured_stderr.getvalue()
if _failure is None:
    try:
        _envelope = {{"ok": True, "value": None, "stdout": _stdout, "stderr": _stderr}}
        if _payload["mode"] == "judge":
            _envelope["value"] = _result
        print(json.dumps(_envelope, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    except (TypeError, ValueError) as _error:
        print(json.dumps({{"ok": False, "kind": "json-bridge-error", "details": repr(_error), "stdout": _stdout, "stderr": _stderr}}, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
else:
    print(json.dumps({{"ok": False, "kind": _failure["kind"], "details": _failure["details"], "stdout": _stdout, "stderr": _stderr}}, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
"#,
        carrier = carrier,
    ))
}

fn main() {
    let mut stdin = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut stdin) {
        failure(
            "json-bridge-error",
            format!("Could not read runner request: {error}"),
        );
        return;
    }
    let request: Request = match serde_json::from_str(&stdin) {
        Ok(request) => request,
        Err(error) => {
            failure(
                "json-bridge-error",
                format!("Invalid runner request JSON: {error}"),
            );
            return;
        }
    };
    let program = match bridge_program(&request) {
        Ok(program) => program,
        Err(error) => {
            failure(
                "json-bridge-error",
                format!("Could not serialize runner request: {error}"),
            );
            return;
        }
    };

    let interpreter = InterpreterBuilder::new().init_stdlib().interpreter();
    interpreter.run(|vm| -> rustpython::vm::PyResult<()> {
        let scope = vm.new_scope_with_builtins();
        if let Err(error) = vm.run_string(scope, &program, "<localcoder-runner>".to_owned()) {
            let mut details = String::new();
            vm.write_exception(&mut details, &error)
                .expect("formatting into String cannot fail");
            failure("python-runtime-error", details);
        }
        Ok(())
    });
}
