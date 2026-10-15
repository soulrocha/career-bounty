"""Gera a golden do merge/dedup (refresh.py `_merged`) sobre cenários SINTÉTICOS (F1.11).

    node tests/golden/make-cenarios-merge.mjs > cenarios.json
    python -B gerar-refresh-merge.py cenarios.json <pasta-com-refresh.py> tests/golden/refresh-merge.json

Cada cenário roda numa pasta temporária; o refresh.py é importado e `ROOT`/`PIPELINE`/`STAMP` são trocados.
Nada é lido nem gravado na pasta de origem (sem bytecode) e o pipeline real não participa.
"""
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.dont_write_bytecode = True
entrada, pasta, saida = sys.argv[1:4]
sys.path.insert(0, str(Path(__file__).parent))
from refresh_sintetico import carregar  # noqa: E402

refresh = carregar(pasta)


def escrever(caminho, dados):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False), encoding='utf-8')


with open(entrada, encoding='utf-8') as arquivo:
    cenarios = json.load(arquivo)

resultado = []
for cenario in cenarios:
    item = dict(cenario)
    with tempfile.TemporaryDirectory() as pasta_temp:
        raiz = Path(pasta_temp)
        pipeline = raiz / 'pipeline.json'
        escrever(pipeline, cenario['pipeline'])
        escrever(raiz / 'config.json', cenario['config'])
        if cenario.get('historico') is not None:
            escrever(raiz / 'historico' / 'pipeline-antes-2026-10-01.json', {'vagas': cenario['historico']})
        for arquivo_pesquisa in cenario['pesquisas']:
            alvo = raiz / arquivo_pesquisa['nome']
            escrever(alvo, {'vagas': arquivo_pesquisa['vagas'], 'cobertura': arquivo_pesquisa.get('cobertura') or []})
            momento = datetime.fromisoformat(arquivo_pesquisa['mtime'] + 'T12:00:00').replace(tzinfo=ZoneInfo('America/Sao_Paulo')).timestamp()
            os.utime(alvo, (momento, momento))
        if cenario['ajustes']:
            escrever(raiz / 'ajustes-revisao.json', cenario['ajustes'])
        try:
            with patch.object(refresh, 'ROOT', raiz), patch.object(refresh, 'PIPELINE', pipeline), patch.object(refresh, 'STAMP', cenario['hoje']):
                refresh._merged()
            item['saida'] = json.loads(pipeline.read_text(encoding='utf-8'))
        except Exception as erro:  # a golden registra também o que o legado recusa
            item['erro'] = type(erro).__name__
    resultado.append(item)

with open(saida, 'w', encoding='utf-8') as arquivo:
    json.dump({'python': sys.version.split()[0], 'cenarios': resultado}, arquivo, ensure_ascii=False, indent=0)
    arquivo.write('\n')
print(len(resultado), 'cenarios;', sum('erro' in c for c in resultado), 'erros registrados')
