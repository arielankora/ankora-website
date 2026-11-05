"""Extract attachments from a Gmail get_message RAW result.

Usage: python3 -I extract_attachments.py <saved-result.json> <empty-output-dir> [name-filter]

The input is the JSON that the Gmail connector's get_message returns with
messageFormat RAW (Claude Code saves it to a file when it is large).
"""
import base64
import email
import json
import os
import sys
from email import policy


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    name_filter = sys.argv[3].lower() if len(sys.argv) > 3 else ""
    with open(src, encoding="utf-8") as f:
        raw = json.load(f)["raw"]
    raw += "=" * (-len(raw) % 4)
    msg = email.message_from_bytes(base64.urlsafe_b64decode(raw), policy=policy.default)
    os.makedirs(out, exist_ok=True)
    count = 0
    for part in msg.iter_attachments():
        name = os.path.basename(part.get_filename() or f"attachment-{count + 1}.bin")
        if name_filter and name_filter not in name.lower():
            continue
        data = part.get_payload(decode=True) or b""
        path = os.path.join(out, name)
        with open(path, "wb") as f:
            f.write(data)
        count += 1
        print(f"{path}\t{len(data)} bytes\t{part.get_content_type()}")
    if count == 0:
        sys.exit("No matching attachments found.")


if __name__ == "__main__":
    main()
