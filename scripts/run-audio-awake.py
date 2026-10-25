"""Run the long audio batch with a temporary Windows idle-sleep hold."""
import ctypes
import os
import subprocess
import sys

if os.name == 'nt':
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
try:
    workflow = '--workflow' in sys.argv
    arguments = [arg for arg in sys.argv[1:] if arg != '--workflow']
    sys.exit(subprocess.call(['node', 'scripts/finish-complete-audio.mjs' if workflow else 'scripts/analyze-youtube-catalog.mjs', *arguments],
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0))
finally:
    if os.name == 'nt':
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
