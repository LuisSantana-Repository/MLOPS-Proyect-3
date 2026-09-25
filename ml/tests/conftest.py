import sys
from pathlib import Path

# Permite `import make_crops` sin instalar el script como paquete.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
