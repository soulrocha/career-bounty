"""Gera a golden de caracterização das regras puras do refresh.py (F1.10/F1.11).

Roda UMA vez, fora do `npm test`, sobre entradas SINTÉTICAS; nunca sobre o pipeline real:

    node tests/golden/make-vagas-regras.mjs > entrada.json
    python -B gerar-refresh-regras.py entrada.json <pasta-com-refresh.py> tests/golden/refresh-regras.json

Só o JSON de saída é versionado. O refresh.py é importado, não executado (o `main` não roda), e nada é gravado
na pasta de origem (sem bytecode).
"""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
entrada, pasta, saida = sys.argv[1:4]
sys.path.insert(0, str(Path(__file__).parent))
from refresh_sintetico import carregar  # noqa: E402

refresh = carregar(pasta)

funcoes = {
    'canonicalUrl': lambda e: getattr(refresh, 'canon' + 'ical')(e['url']),
    'company_key': lambda e: refresh.company_key(e['nome']),
    'role_key': lambda e: refresh.role_key(e['job']),
    'id_for': lambda e: refresh.id_for(e['job']),
    'portal_candidatura': lambda e: refresh.portal_candidatura(e['job']),
    'curriculo_necessario': lambda e: refresh.curriculo_necessario(e['job'], e['config']),
    'constraints': lambda e: refresh.constraints(e['job'], e['config']),
}

with open(entrada, encoding='utf-8') as arquivo:
    casos = json.load(arquivo)

resultado = []
for caso in casos:
    item = dict(caso)
    try:
        item['saida'] = funcoes[caso['funcao']](caso['entrada'])
    except Exception as erro:  # a golden registra também o que o legado recusa
        item['erro'] = type(erro).__name__
    resultado.append(item)

with open(saida, 'w', encoding='utf-8') as arquivo:
    json.dump({'python': sys.version.split()[0], 'casos': resultado}, arquivo, ensure_ascii=False, indent=0)
    arquivo.write('\n')
print(len(resultado), 'casos;', sum('erro' in c for c in resultado), 'erros registrados')
