"""Provisioning templates por fabricante.
Cada função recebe um dict `cfg` e retorna (filename, content, content_type).

cfg = {
  "mac": "001122aabbcc"  # sem separadores, lowercase
  "mac_upper": "001122AABBCC"
  "extension": "9165",
  "auth_user": "9165",
  "auth_password": "senhasecreta",
  "display_name": "Paulo Barbosa",
  "domain": "grupoicore.cliente.voxyra.net.br",
  "sip_server": "grupoicore.cliente.voxyra.net.br",
  "sip_port": 5060,
  "transport": "udp",      # udp | tcp | tls
  "codecs": ["PCMA", "PCMU", "G722"],
  "label": "9165",
}
"""
from typing import Dict, Any, Tuple

VENDORS = {
    "yealink": "Yealink (T19/T21/T23/T27/T29/T46/T48/T54W e demais)",
    "cisco": "Cisco SIP (6921/6941/7942/7945/8841...)",
    "polycom": "Polycom VVX/SoundPoint",
    "siemens": "Siemens/Unify OpenStage/OpenScape",
    "flyvoice": "Flyvoice (compatível Yealink)",
    "grandstream": "Grandstream GXP",
}


def _normalize_mac(mac: str) -> Dict[str, str]:
    m = "".join(c for c in (mac or "").lower() if c.isalnum())
    return {"mac": m, "mac_upper": m.upper()}


def render_yealink(cfg: Dict[str, Any]) -> Tuple[str, str, str]:
    """Yealink — formato MAC.cfg (config por device)."""
    codecs = "\n".join(
        f"account.1.codec.{i+1}.enable = 1\naccount.1.codec.{i+1}.payload_type = {c}"
        for i, c in enumerate(cfg.get("codecs") or ["PCMA", "PCMU", "G722"])
    )
    content = f"""#!version:1.0.0.1
# Voxyra provisioning · {cfg.get('extension')} · gerado automaticamente

account.1.enable = 1
account.1.label = {cfg.get('label') or cfg.get('extension')}
account.1.display_name = {cfg.get('display_name', '')}
account.1.auth_name = {cfg.get('auth_user')}
account.1.user_name = {cfg.get('extension')}
account.1.password = {cfg.get('auth_password')}
account.1.sip_server.1.address = {cfg.get('sip_server')}
account.1.sip_server.1.port = {cfg.get('sip_port', 5060)}
account.1.sip_server.1.transport_type = {0 if cfg.get('transport','udp')=='udp' else (1 if cfg['transport']=='tcp' else 2)}
account.1.outbound_proxy_enable = 0
account.1.register_expires = 3600
account.1.sip_server_type = 0
{codecs}

# Behavior
features.dnd.enable = 1
features.intercom.allow = 1
features.local_dial_tone = 1
phone_setting.lock_logo_upload.enable = 0
"""
    return f"{cfg['mac']}.cfg", content, "text/plain"


def render_cisco(cfg: Dict[str, Any]) -> Tuple[str, str, str]:
    """Cisco SIP firmware — SEP<MAC>.cnf.xml. MAC em UPPERCASE no nome do arquivo."""
    proxy = cfg.get("sip_server")
    port = cfg.get("sip_port", 5060)
    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- Voxyra provisioning · ramal {cfg.get('extension')} -->
<device>
  <deviceProtocol>SIP</deviceProtocol>
  <sshUserId/>
  <sshPassword/>
  <devicePool>
    <dateTimeSetting>
      <dateTemplate>D/M/YA</dateTemplate>
      <timeZone>E. South America Standard Time</timeZone>
    </dateTimeSetting>
    <callManagerGroup>
      <members>
        <member priority="0">
          <callManager>
            <ports>
              <ethernetPhonePort>2000</ethernetPhonePort>
              <sipPort>{port}</sipPort>
              <securedSipPort>5061</securedSipPort>
            </ports>
            <processNodeName>{proxy}</processNodeName>
          </callManager>
        </member>
      </members>
    </callManagerGroup>
  </devicePool>
  <sipProfile>
    <sipProxies>
      <backupProxy></backupProxy>
      <backupProxyPort></backupProxyPort>
      <emergencyProxy></emergencyProxy>
      <emergencyProxyPort></emergencyProxyPort>
      <outboundProxy>{proxy}</outboundProxy>
      <outboundProxyPort>{port}</outboundProxyPort>
      <registerWithProxy>true</registerWithProxy>
    </sipProxies>
    <sipCallFeatures>
      <cnfJoinEnabled>true</cnfJoinEnabled>
      <callForwardURI>x-cisco-serviceuri-cfwdall</callForwardURI>
      <callPickupURI>x-cisco-serviceuri-pickup</callPickupURI>
    </sipCallFeatures>
    <sipLines>
      <line button="1">
        <featureID>9</featureID>
        <featureLabel>{cfg.get('label') or cfg.get('extension')}</featureLabel>
        <proxy>{proxy}</proxy>
        <port>{port}</port>
        <name>{cfg.get('extension')}</name>
        <displayName>{cfg.get('display_name', '')}</displayName>
        <authName>{cfg.get('auth_user')}</authName>
        <authPassword>{cfg.get('auth_password')}</authPassword>
        <messageWaitingLampPolicy>3</messageWaitingLampPolicy>
        <contact>{cfg.get('extension')}</contact>
        <messagesNumber>*97</messagesNumber>
      </line>
    </sipLines>
    <preferredCodec>g711alaw</preferredCodec>
  </sipProfile>
  <commonProfile>
    <phonePassword></phonePassword>
    <backgroundImageAccess>true</backgroundImageAccess>
  </commonProfile>
  <loadInformation></loadInformation>
  <vendorConfig></vendorConfig>
  <versionStamp>{int(__import__('time').time())}</versionStamp>
  <userLocale>
    <name>Portuguese_Brazil</name>
    <uid>13</uid>
    <langCode>pt_BR</langCode>
  </userLocale>
  <networkLocale>Brazil</networkLocale>
  <idleTimeout>0</idleTimeout>
  <authenticationURL></authenticationURL>
  <directoryURL></directoryURL>
  <servicesURL></servicesURL>
</device>
"""
    return f"SEP{cfg['mac_upper']}.cnf.xml", content, "application/xml"


def render_polycom(cfg: Dict[str, Any]) -> Tuple[str, str, str]:
    """Polycom VVX/SoundPoint — <MAC>.cfg apontando para configs."""
    content = f"""<?xml version="1.0" standalone="yes"?>
<!-- Voxyra provisioning · ramal {cfg.get('extension')} -->
<polycomConfig>
  <reg
    reg.1.address="{cfg.get('extension')}"
    reg.1.label="{cfg.get('label') or cfg.get('extension')}"
    reg.1.displayName="{cfg.get('display_name','')}"
    reg.1.auth.userId="{cfg.get('auth_user')}"
    reg.1.auth.password="{cfg.get('auth_password')}"
    reg.1.server.1.address="{cfg.get('sip_server')}"
    reg.1.server.1.port="{cfg.get('sip_port',5060)}"
    reg.1.server.1.transport="{cfg.get('transport','udp').upper()}DPreferred"
    reg.1.server.1.expires="3600"
    reg.1.outboundProxy.address=""
  />
  <voIpProt
    voIpProt.SIP.outboundProxy.address=""
    voIpProt.server.dhcp.enabled="0"
  />
  <feature
    feature.urlDialing.enabled="0"
    feature.directedCallPickup.enabled="1"
  />
</polycomConfig>
"""
    return f"{cfg['mac']}.cfg", content, "application/xml"


def render_siemens(cfg: Dict[str, Any]) -> Tuple[str, str, str]:
    """Siemens/Unify OpenStage/OpenScape — provisioning DLS via XML simples.
    Para um deploy completo seria necessário o DLS server, mas o XML abaixo
    serve para muitos modelos com auto-provisioning HTTP simples."""
    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- Voxyra provisioning · ramal {cfg.get('extension')} (Siemens/Unify) -->
<unify-provisioning>
  <device mac="{cfg['mac_upper']}">
    <sip>
      <registrar>{cfg.get('sip_server')}:{cfg.get('sip_port',5060)}</registrar>
      <proxy>{cfg.get('sip_server')}:{cfg.get('sip_port',5060)}</proxy>
      <user-id>{cfg.get('extension')}</user-id>
      <auth-name>{cfg.get('auth_user')}</auth-name>
      <password>{cfg.get('auth_password')}</password>
      <display-name>{cfg.get('display_name','')}</display-name>
      <transport>{cfg.get('transport','udp').upper()}</transport>
      <register-period>3600</register-period>
    </sip>
    <codecs>
      {''.join(f'<codec>{c}</codec>' for c in (cfg.get('codecs') or ['PCMA','PCMU','G722']))}
    </codecs>
  </device>
</unify-provisioning>
"""
    return f"{cfg['mac_upper']}.xml", content, "application/xml"


def render_flyvoice(cfg: Dict[str, Any]) -> Tuple[str, str, str]:
    """Flyvoice — compatível com formato Yealink."""
    fname, content, ct = render_yealink(cfg)
    return fname, content, ct


def render_grandstream(cfg: Dict[str, Any]) -> Tuple[str, str, str]:
    """Grandstream GXP — formato cfg<MAC>.xml."""
    content = f"""<?xml version="1.0" encoding="UTF-8" ?>
<!-- Voxyra provisioning · ramal {cfg.get('extension')} -->
<gs_provision version="1">
  <mac>{cfg['mac_upper']}</mac>
  <config version="1">
    <P271>1</P271>
    <P47>{cfg.get('sip_server')}</P47>
    <P35>{cfg.get('extension')}</P35>
    <P36>{cfg.get('display_name','')}</P36>
    <P3>{cfg.get('auth_user')}</P3>
    <P34>{cfg.get('auth_password')}</P34>
    <P78>3600</P78>
  </config>
</gs_provision>
"""
    return f"cfg{cfg['mac']}.xml", content, "application/xml"


RENDERERS = {
    "yealink": render_yealink,
    "cisco": render_cisco,
    "polycom": render_polycom,
    "siemens": render_siemens,
    "flyvoice": render_flyvoice,
    "grandstream": render_grandstream,
}


def render_config(vendor: str, cfg: Dict[str, Any]) -> Tuple[str, str, str]:
    """Retorna (filename, content, content_type)."""
    cfg = {**cfg, **_normalize_mac(cfg.get("mac", ""))}
    if vendor not in RENDERERS:
        raise ValueError(f"Fabricante não suportado: {vendor}")
    return RENDERERS[vendor](cfg)
