==========================================================
 Voxyra CCA - Template Cisco 6921 / 6941 para FusionPBX
==========================================================

Arquivos neste pacote:

  1. SEP_TEMPLATE.cnf.xml
     Configuracao por aparelho. Renomeie para SEP<MAC>.cnf.xml
     com o MAC em UPPERCASE, sem `:` ou `-`.
     Ex.: SEP001122AABBCC.cnf.xml

  2. SIPDefault.cnf
     Defaults globais. Use com nome literal SIPDefault.cnf.

  3. dialplan.xml
     Plano de discagem (timeout por padrao). Nome literal.

==========================================================
 PASSO A PASSO
==========================================================

1. Garanta que o telefone esteja com firmware SIP (NAO SCCP).
   Se na tela aparece "SCCP", troque firmware antes:
     cmterm-6921_6941-sip.9-4-2SR3-1.zip

2. Coloque os 3 arquivos em /var/lib/tftpboot/ no servidor
   FusionPBX, com permissao 644:
     chmod 644 /var/lib/tftpboot/SEP*.cnf.xml
     chmod 644 /var/lib/tftpboot/SIPDefault.cnf
     chmod 644 /var/lib/tftpboot/dialplan.xml
     chown tftp:tftp /var/lib/tftpboot/*

3. Edite SEP<MAC>.cnf.xml e substitua:
     DOMINIO_FUSIONPBX  -> grupoicore.cliente.voxyra.net.br
     RAMAL              -> 9165
     NOME_DISPLAY       -> Paulo Barbosa
     SENHA_SIP          -> senha cadastrada no FusionPBX

4. Edite SIPDefault.cnf e substitua:
     DOMINIO_FUSIONPBX  -> grupoicore.cliente.voxyra.net.br

5. No DHCP da rede dos telefones, configure option 150 ou 66
   apontando para o IP do servidor TFTP.

6. No telefone:
     Settings -> Admin Settings (senha 'cisco')
     Reset Settings -> All
   Aguarde reboot e download dos arquivos.

==========================================================
 POR QUE REGISTRA COM @DOMINIO E NAO @IP
==========================================================

Tres campos no XML estao com FQDN (DNS) ao inves de IP:

  <processNodeName>      DOMINIO_FUSIONPBX
  <outboundProxy>        DOMINIO_FUSIONPBX
  <line><proxy>          DOMINIO_FUSIONPBX  <-- O IMPORTANTE

O <line><proxy> e usado pelo firmware Cisco para construir
o cabecalho "From:" do REGISTER. Com FQDN, o pacote sai como:

  From: <sip:9165@grupoicore.cliente.voxyra.net.br>

que e exatamente o que o FusionPBX multi-tenant espera.

==========================================================
 VERIFICACAO
==========================================================

No FusionPBX -> Status -> Registrations, voce deve ver:

  9165@grupoicore.cliente.voxyra.net.br
  192.168.x.x:5060   Cisco-CP6921/9.4.2SR3

Logs do FreeSWITCH:
  fs_cli -x "sofia status profile internal reg"

==========================================================
 SUPORTE
==========================================================
Voxyra CCA - https://voxyra.net.br
