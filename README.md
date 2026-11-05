# RetroAmp

Player de MP3 estilo anos 90, feito só com HTML, CSS e JavaScript (Web Audio API). Sem build, sem dependências.

## Rodar

App desktop (Electron, janela sem bordas):

```bash
npm install
npm start
```

Gerar o executável para Linux (sai em `dist/RetroAmp-1.0.0-x86_64.AppImage`):

```bash
npm run dist
```

Ou no navegador, sem instalar nada:

```bash
python3 -m http.server 5173
```

Depois abra http://localhost:5173 e arraste músicas (ou pastas) para a janela.

## Recursos

- Display LCD com tempo (clique alterna decorrido/restante), título rolante, kbps, kHz, mono/estéreo
- Visualizador: espectro com picos, osciloscópio ou desligado (clique para alternar)
- Equalizador de 10 bandas + pré-amplificador, presets, curva ao vivo (duplo clique zera uma banda)
- Playlist com busca, reordenação por arrastar, seleção múltipla (Ctrl/Shift), ordenar, remover
- Lê tags ID3v1/ID3v2 (artista - título)
- Shuffle, repeat (playlist / faixa), volume e balanço
- Teclas de mídia do sistema (Media Session) e configurações salvas no navegador
- Skins: dez prontas e suporte a skins próprias em arquivo `.json`

## Organizar as seções

- Os botões **EQ / PL / NET / LY / CV** mostram ou escondem cada seção.
- **Arraste uma seção pela barra de título** para mudar a ordem ou levá-la para a outra coluna (a janela principal fica sempre no topo da 1ª).
- **Duplo clique no título** recolhe a seção, deixando só a barra.
- O botão **▥** no título da janela principal alterna entre 1 e 2 colunas.
- No app desktop a janela se ajusta sozinha ao conteúdo e nunca passa da altura da tela; se passar, aparece uma barra de rolagem.

O layout fica salvo.

## Letra da música

O botão **LY** abre a janela de letra. A letra é procurada nesta ordem:

1. Um arquivo `.lrc` com o mesmo nome do MP3 (ex.: `Banda - Música.lrc` ao lado de `Banda - Música.mp3`), adicionado junto com a música ou depois.
2. A letra gravada nas tags do MP3 (ID3 `USLT`).
3. Letras já baixadas antes: ficam guardadas no app e aparecem mesmo sem internet ou com o site fora do ar (mostra "(guardada)").
4. O [LRCLIB](https://lrclib.net), base aberta de letras sincronizadas (precisa de internet). Quando ele está sobrecarregado (erro 503), o player tenta de novo algumas vezes sozinho.
5. O [lyrics.ovh](https://lyrics.ovh), como reserva quando o LRCLIB está fora do ar ou não tem a música (só o texto, sem sincronia). Enquanto a música está na tela, o player volta a tentar o LRCLIB algumas vezes e troca sozinho pela letra sincronizada quando ela aparecer; letra sem sincronia guardada também é trocada pela sincronizada na próxima vez que a música tocar.

Se mesmo assim der erro, clique na área da letra para tentar de novo.

**GRAVAR** coloca a letra baixada (LRCLIB ou lyrics.ovh) dentro do MP3, já com o ajuste de sincronia aplicado. Assim ela aparece em qualquer computador e em outros players, sem depender da internet. Na versão de navegador, baixa uma cópia da música com a letra.

Letras sincronizadas destacam a linha atual e rolam sozinhas; clique numa linha para pular para aquele trecho. **−0,5s / +0,5s** ajustam a sincronia (útil em gravações ao vivo) e **OUTRA** tenta o próximo resultado do LRCLIB quando a letra vier errada (ou sem sincronia); a escolhida fica guardada.

## Editar as tags

Selecione uma ou mais faixas na playlist e clique em **TAG** (ou tecla **T**) para abrir a janela de tags: título, artista, álbum, ano, faixa, gênero e capa.

- **DO NOME** preenche título, artista e número da faixa a partir do nome do arquivo (`01 - Banda - Música.mp3`) e o álbum pelo nome da pasta.
- **BUSCAR** procura a música no [MusicBrainz](https://musicbrainz.org) pelo título e artista e preenche álbum, ano, faixa e gênero; se vier o disco errado, escolha outro na lista.
- **CAPA**: **⇩ BAIXAR** traz a capa do disco do [Cover Art Archive](https://coverartarchive.org) (pelo álbum, ou pela música e artista); **ARQUIVO** usa uma imagem JPG/PNG do computador; **TIRAR** remove a capa. Com várias faixas selecionadas (um álbum inteiro, por exemplo), a capa vai para todas.
- **SALVAR** grava no próprio MP3, mantendo a letra, a capa e as outras informações que já estavam lá. Na versão de navegador, baixa uma cópia já com as tags.

Com várias faixas selecionadas, só os campos em comum são editados (campos em branco ficam como estão), e **DO NOME** usa o nome de cada arquivo.

## Capa do disco

O botão **CV** mostra a janela da capa da música que está tocando (a imagem gravada no MP3). Ela também aparece nos controles de mídia do sistema. Sem capa, ou com a capa errada, clique em **⇩ BAIXAR** para procurar no Cover Art Archive; **OUTRA** tenta outro disco e **GRAVAR** coloca a capa dentro do MP3 (no navegador, baixa uma cópia da música já com a capa).

## Buscar música (só no app desktop)

O botão **NET** abre a busca: digite música e/ou banda, ouça uma prévia (▶) e clique em **⇩ BAIXAR** (ou **⇩ TODOS** para enfileirar todos os resultados). Os downloads entram numa fila e são feitos um por vez: clique em **NA FILA** para tirar uma faixa da fila, na porcentagem para cancelar, ou em **CANCELAR** para parar tudo. O MP3 vai para a pasta da biblioteca (padrão `~/Música/RetroAmp`, dá para mudar) e entra na playlist.

Só busca em acervos com download liberado:

- **Internet Archive**: Live Music Archive (shows ao vivo que as bandas autorizam gravar), netlabels, discos de 78 rpm e itens com licença declarada. Não precisa de cadastro.
- **Jamendo**: música independente Creative Commons. Precisa de uma chave gratuita (`client_id`) criada em https://devportal.jamendo.com — cole no campo **CHAVE JAMENDO** e clique em **SALVAR**.

Faixas de estúdio de gravadoras normalmente não estão nesses acervos.

## Skins

O botão **◐** no título da janela principal abre o menu de skins (ou aperte **K** para passar para a próxima). Vêm dez prontas: **Clássico**, **Âmbar**, **Neon**, **Futuro**, **Brasil**, **Alumínio**, **Steampunk**, **Amplificador**, **Bege 95** e **Alto contraste**. A escolhida fica salva.

Com a skin **Amplificador**, aparecem duas caixas de som ao lado do player. Os cones pulsam com a música: o de cima com os graves e o de baixo com os médios. No app desktop dá para arrastar a janela pelas caixas. Na versão de navegador, elas só aparecem se couberem na mesma linha do player.

Para criar a sua:

1. Escolha a skin mais parecida com o que você quer e clique em **EXPORTAR**. Sai um arquivo `.retroamp-skin.json` com todas as cores.
2. Edite o arquivo: troque o `name` e as cores que quiser (qualquer cor CSS: `#3dff7a`, `rgb(...)`, `orange`...).
3. Clique em **CARREGAR…** e escolha o arquivo. A skin fica guardada no app; **REMOVER** apaga a skin carregada que estiver em uso.

```json
{
  "name": "Minha skin",
  "colors": {
    "lcd": "#3dff7a",
    "lcd-bg": "#040705",
    "accent": "#ffb52e"
  }
}
```

Cores que faltarem no arquivo usam as do Clássico. As principais: `chrome-hi`/`chrome-lo` (corpo das janelas), `btn-hi`/`btn-lo`/`btn-text` (botões), `lcd-bg`/`lcd`/`lcd-dim` (display), `accent` (títulos, barra de posição, EQ), `sel-bg` (seleção na playlist) e `vis-low`/`vis-mid`/`vis-high`/`vis-top`/`vis-peak` (visualizador).

## Atalhos

| Tecla | Ação |
|---|---|
| Espaço | tocar/pausar |
| Z / X / C / V / B | anterior / tocar / pausar / parar / próxima |
| ← / → | voltar/avançar 5 s |
| ↑ / ↓ | volume |
| L | abrir arquivos |
| S / R | shuffle / repeat |
| T | editar as tags das selecionadas |
| K | trocar de skin |
| Enter / Del | tocar / remover selecionadas |
