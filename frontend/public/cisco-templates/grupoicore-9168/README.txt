==============================================================
 Voxyra CCA - Pacote Cisco 6921 - Ramal 9168 - Grupo Icore
==============================================================

CONFIGURACAO DESTE PACOTE:
  Tenant       : Grupo Icore
  Dominio      : grupoicore.cliente.voxyra.net.br
  Servidor     : callvoxysipbr01.voxyra.net.br
  IP publico   : 51.222.195.17
  Ramal        : 9168
  Senha SIP    : sFoKg9CxyRnPLL572DuQ
  MAC telefone : 18:9C:5D:AB:26:48
  Modelo       : Cisco 6921 (firmware SIP 9.4.1)

ARQUIVOS NESTE PACOTE:

  1. SEP189C5DAB2648.cnf.xml
     Configuracao do telefone. Nome ja correto, copiar como esta.

  2. SIPDefault.cnf
     Defaults globais do SIP firmware.

  3. dialplan.xml
     Plano de discagem (ajuste os MATCH conforme seu plano).

  4. internal.xml.patch
     Snippet de 6 parametros para adicionar em
     /etc/freeswitch/sip_profiles/internal.xml
     (resolve o bug 401-loop do Cisco 9.4.1).

==============================================================
 SEQUENCIA DE INSTALACAO (no servidor FusionPBX)
==============================================================

PARTE A - Arquivos TFTP do telefone

  cd /var/lib/tftpboot/
  # copie os 3 arquivos para esta pasta
  chmod 644 SEP189C5DAB2648.cnf.xml SIPDefault.cnf dialplan.xml
  chown tftpd:tftpd SEP189C5DAB2648.cnf.xml SIPDefault.cnf dialplan.xml

  # confirme que o tftpd esta rodando
  systemctl status tftpd-hpa

  # teste local
  tftp 127.0.0.1 -c get SEP189C5DAB2648.cnf.xml /tmp/test.xml
  head -5 /tmp/test.xml

PARTE B - Patch do FreeSWITCH (CRITICO p/ Cisco 9.4.1)

  sudo nano /etc/freeswitch/sip_profiles/internal.xml

  Encontre o bloco <settings> dentro de <profile name="internal">
  e adicione, ANTES do </settings>, os 6 parametros do arquivo
  internal.xml.patch.

  Salve e recarregue:

  fs_cli -x "sofia profile internal restart reloadxml"
  sleep 5
  fs_cli -x "sofia status profile internal"
  # deve mostrar "RUNNING (NOTING)" e listar os aliases

PARTE C - DHCP e telefone

  1. No DHCP da rede dos telefones, option 150 ou 66 com IP do
     servidor TFTP (geralmente o proprio IP do FusionPBX 51.222.195.17).

  2. No telefone:
       Settings -> Admin Settings (senha 'cisco')
       Reset Settings -> All
     Aguarde reboot completo (1-2 minutos).

PARTE D - Verificacao

  # No FusionPBX, confira o registro:
  fs_cli -x "sofia status profile internal reg" | grep 9168

  Resultado esperado:
    Call-ID:           ...@177.10.10.197
    User:              9168@grupoicore.cliente.voxyra.net.br
    Contact:           "..."<sip:9168@177.10.10.197:5060...>
    Agent:             Cisco-CP6921/9.4.1
    Status:            Registered(UDP)(unknown) EXP(...)
    Host:              ...

  Se aparecer "User: 9168@grupoicore.cliente.voxyra.net.br"
  -> SUCESSO! O force-register-domain corrigiu.

==============================================================
 SE NAO FUNCIONAR APOS A CORRECAO
==============================================================

  # Habilite log de SIP em tempo real
  fs_cli
  sofia loglevel all 9
  sofia global siptrace on

  # Em outro terminal, reinicie o telefone e observe.
  # Procure por linhas com "9168" no fs_cli para entender
  # exatamente onde esta falhando.

  # Para desligar o trace depois:
  sofia global siptrace off
  sofia loglevel all 0

==============================================================
 SUPORTE
==============================================================
  Voxyra CCA - https://voxyra.net.br
