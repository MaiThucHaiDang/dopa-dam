#!/usr/bin/env python3
"""Turns an .xcresult into files that can be read without Xcode.

  collect-results.py <path.xcresult> <output folder> [label]

Writes into the output folder:
  summary.txt          one PASS/FAIL line per test, the failure messages, and totals (exit status 1 on any failure)
  screenshots/         every screenshot of the tests as <Test>/<NN name>.png, in the order the test took them
  notes/               the text attachments (element trees of failed tests, how the phrase was typed, ...)
  summary.json, tests.json   what `xcresulttool get test-results` says, unchanged
"""
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True)


def slug(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower() or "x"


def walk(node, visit, parents=()):
    if isinstance(node, dict):
        visit(node, parents)
        for value in node.values():
            walk(value, visit, parents + (node,))
    elif isinstance(node, list):
        for item in node:
            walk(item, visit, parents)


def main() -> int:
    xcresult, out = sys.argv[1], sys.argv[2]
    label = sys.argv[3] if len(sys.argv) > 3 else ""
    os.makedirs(out, exist_ok=True)
    lines = [f"result bundle: {os.path.basename(xcresult)} {label}".strip()]
    failed = 0
    if not os.path.isdir(xcresult):
        lines.append("no result bundle: the tests did not run (see xcodebuild-test.log)")
        open(os.path.join(out, "summary.txt"), "w").write("\n".join(lines) + "\n")
        return 1

    # Test results.
    for name, args in (("summary", ["get", "test-results", "summary"]), ("tests", ["get", "test-results", "tests"])):
        done = run("xcrun", "xcresulttool", *args, "--path", xcresult)
        open(os.path.join(out, f"{name}.json"), "w").write(done.stdout if done.returncode == 0 else done.stderr)
    passed = skipped = 0
    try:
        tests = json.load(open(os.path.join(out, "tests.json")))

        def visit(node, parents):
            nonlocal passed, failed, skipped
            if node.get("nodeType") == "Test Case":
                result = node.get("result", "?")
                suite = next((p.get("name", "") for p in reversed(parents) if p.get("nodeType") == "Test Suite"), "")
                duration = node.get("durationInSeconds") or node.get("duration") or ""
                if result == "Passed":
                    passed += 1
                elif result == "Skipped":
                    skipped += 1
                else:
                    failed += 1
                lines.append(f"{'PASS' if result == 'Passed' else result.upper():5} {suite}.{node.get('name')}  {duration}")
                if result != "Passed":
                    def failures(child, _):
                        if child.get("nodeType") == "Failure Message":
                            lines.append(f"        {child.get('name')}")
                    walk(node.get("children", []), failures)

        walk(tests, visit)
    except Exception as error:  # the layout of the JSON is Xcode's to change; never lose the rest
        lines.append(f"(could not read tests.json: {error})")
        failed += 1
    lines.append(f"total: {passed + failed + skipped}, passed: {passed}, failed: {failed}, skipped: {skipped}")

    # Attachments.
    raw = os.path.join(out, "attachments-raw")
    shutil.rmtree(raw, ignore_errors=True)
    done = run("xcrun", "xcresulttool", "export", "attachments", "--path", xcresult, "--output-path", raw)
    if done.returncode != 0:
        lines.append(f"(export attachments failed: {done.stderr.strip()[:300]})")
    else:
        count = {"png": 0, "notes": 0}

        def export(node, parents):
            exported = node.get("exportedFileName")
            if not exported:
                return
            test = next((p.get("testIdentifierString") or p.get("testIdentifier") for p in reversed(parents)
                         if p.get("testIdentifierString") or p.get("testIdentifier")), "unknown")
            human = node.get("suggestedHumanReadableName") or exported
            stem, ext = os.path.splitext(human)
            stem = re.sub(r"_\d+_[0-9A-Fa-f-]{36}$", "", stem)
            source = os.path.join(raw, exported)
            if not os.path.isfile(source):
                return
            if ext.lower() in (".mp4", ".mov") or stem.startswith("synthesized-event"):
                return  # screen recordings and raw touch events: large and not needed
            test_dir = slug(test.replace("/", "-").replace("()", ""))
            if ext.lower() in (".png", ".jpg", ".jpeg", ".heic"):
                folder = os.path.join(out, "screenshots", test_dir)
                os.makedirs(folder, exist_ok=True)
                target = os.path.join(folder, slug(stem) + ".png")
                if ext.lower() == ".png":
                    shutil.copyfile(source, target)
                else:
                    run("sips", "-s", "format", "png", source, "--out", target)
                count["png"] += 1
            else:
                folder = os.path.join(out, "notes", test_dir)
                os.makedirs(folder, exist_ok=True)
                shutil.copyfile(source, os.path.join(folder, slug(stem) + (ext or ".txt")))
                count["notes"] += 1

        try:
            walk(json.load(open(os.path.join(raw, "manifest.json"))), export)
        except Exception as error:
            lines.append(f"(could not read the attachment manifest: {error})")
        lines.append(f"screenshots: {count['png']}, text notes: {count['notes']}")
    shutil.rmtree(raw, ignore_errors=True)

    open(os.path.join(out, "summary.txt"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
