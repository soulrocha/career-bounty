"""Carrega o refresh.py do legado (só leitura) trocando, EM MEMÓRIA, a lista fixa de cidades presenciais pela sintética.

O legado guarda essa lista dentro de `constraints()`. Como as fixtures do repositório não podem conter cidade real,
o gerador compila o código do legado com a lista de `regiao-sintetica.json`; nada é gravado na pasta de origem.
"""
import json
import re
import sys
import types
from pathlib import Path

sys.dont_write_bytecode = True
REGIAO = json.loads((Path(__file__).parent / 'regiao-sintetica.json').read_text(encoding='utf-8'))


def carregar(pasta):
    caminho = Path(pasta) / 'refresh.py'
    codigo = caminho.read_text(encoding='utf-8')
    codigo, trocas = re.subn(r'metro=\([^)]*\)', 'metro=' + repr(tuple(REGIAO)), codigo, count=1)
    if trocas != 1:
        raise SystemExit('refresh.py mudou: lista de cidades presenciais não encontrada')
    modulo = types.ModuleType('refresh')
    modulo.__file__ = str(caminho)
    sys.modules['refresh'] = modulo
    sys.path.insert(0, str(pasta))
    exec(compile(codigo, str(caminho), 'exec'), modulo.__dict__)
    return modulo
