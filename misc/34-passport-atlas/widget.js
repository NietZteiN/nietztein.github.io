/* Passport Atlas widget — an interactive globe of the countries I've been to, for any page.
 *
 *   <div id="atlas"></div>
 *   <script src="/misc/34-passport-atlas/widget.js"></script>
 *   <script>PassportAtlas.mount(document.getElementById('atlas'), { theme: 'auto' });</script>
 *
 * Options: theme 'auto' (reads <html data-theme="light|dark">, then prefers-color-scheme),
 * 'light' or 'dark'; link (href of the full page, default the atlas folder next to this
 * script); dataUrl (optional path to countries-110m.json for a higher-detail map; the
 * widget falls back to the coastline embedded below). Returns { el, setTheme, destroy }.
 *
 * What it draws: a slowly turning orthographic globe (drag it, hover to pause, arrow keys
 * to turn), a flat Equal Earth overview, dashed great-circle threads from home to every
 * visited country, the live day/night terminator, flag chips, and a stats line. Canvas
 * only, no dependencies; honours prefers-reduced-motion.
 *
 * Coastline: Natural Earth 1:110m via world-atlas (ISC), simplified by build-widget-data.js.
 */
(function () {
  'use strict';

  // ---- the owner's list (ISO 3166-1 numeric ids, as in world-atlas) ----
  // lat/lon: the city the thread goes to; vlat/vlon: where the globe centres for the country
  var COUNTRIES = [
    { id: '704', name: 'Vietnam',       city: 'Hanoi',          lat: 21.03, lon: 105.85, vlat: 16,   vlon: 106,  cont: 'Asia',          pop: 100987686 },
    { id: '840', name: 'United States', city: 'Texas',          lat: 32.99, lon: -96.75, vlat: 38,   vlon: -98,  cont: 'North America', pop: 345426571, home: true },
    { id: '484', name: 'Mexico',        city: 'Mexico City',    lat: 19.43, lon: -99.13, vlat: 23,   vlon: -102, cont: 'North America', pop: 130861007 },
    { id: '124', name: 'Canada',        city: 'Toronto',        lat: 43.65, lon: -79.38, vlat: 57,   vlon: -95,  cont: 'North America', pop: 39742430 },
    { id: '276', name: 'Germany',       city: 'Berlin',         lat: 52.52, lon: 13.40,  vlat: 51,   vlon: 10,   cont: 'Europe',        pop: 84552242 },
    { id: '380', name: 'Italy',         city: 'Rome',           lat: 41.90, lon: 12.50,  vlat: 42,   vlon: 12.5, cont: 'Europe',        pop: 59342867 },
    { id: '056', name: 'Belgium',       city: 'Brussels',       lat: 50.85, lon: 4.35,   vlat: 50.6, vlon: 4.5,  cont: 'Europe',        pop: 11738763 },
    { id: '392', name: 'Japan',         city: 'Tokyo',          lat: 35.68, lon: 139.69, vlat: 37,   vlon: 138,  cont: 'Asia',          pop: 123753041 }
  ];
  var BY_ID = {}; COUNTRIES.forEach(function (c) { BY_ID[c.id] = c; });
  var VISITED = COUNTRIES.map(function (c) { return c.id; });
  var HOME = BY_ID['840'];
  var WORLD_POP = 8161972572; // UN WPP 2024
  var EARTH_KM = 6371.0088;

  // compact coastline: polyline-encoded rings (0.1 degree), land outlines + visited countries
  var DATA = /* DATA_BEGIN */ {"land":["inB|IECED@JL@HA@IGE","noB`ICA@H@@","coBnILB@GICE?KE","ooBsg@XHXAQHKNIDAFDDb@Cv@LP@^NZJFFZMr@NHGPHZCDLVRAFUB@ZR@FNGF`@JFT\\BDTZPFMF]Jk@I[QK?G_@Ea@Wc@Sc@OO]V@JPr@TNYr@Fp@^OLj@B\\@?M\\CXHz@A`AD~@d@lAn@_@@IJSBKIU@[TAPNR@VF^\\ZFLt@l@JJZJJ?JIZL@FFAFFDD?LHBJHJBHB?H@@G@KHOVEJ?VFHPBNFP@@ICOHSOCLOHC@@D@@CHCEGCC@AEK@CJAFCZDNFRDIIBGOKJINDVLJJR@HHKJOB?HOBUMQFM?AJZBHJPHHLSHGRKPMN?NJBCJKDBNBNJ@LRNZPVZPZNT@JHFEJFZHRBFTH?DMEGZEH@XPNPBLa@n@QJKNGd@@`@NLVJNPVPFKEMNKNAFKHSPGP?COP?@TNl@?NM?GPCPIHKBIHE@KJGJ?L@HADAJGDEP?DL@POVO@IJK@QFIAMBIFEBIRUBJBICMEQ@OEMFKAUFIDWBYFOLHTLJAJCEYBQNWCEJCLODI@IBIFKP?AFDJHC@@LC@FL?VB?NHHZLVVLJRL?FHDPDH@DNCXANFP?`@J@FNEDPDFJFDPQH[FSDIHQDYBKP[Fe@DY?WBSZJLAXWGGDETQNCDOLMd@B^?Z@d@ETCTAFYHAN@RHVEROREJQNYH@LEDFJACH@BM^IBCFMF?F@FADEDEH@MEIEAED?JBJCFCA?DOC[@MMMKMMEEA@@F@BANGLKDMBK@MPGB?BHPFDFLHABD@HAJ@BH?JD@HBBJ?FD?FHDJAJDH?LDBH?DRF^HPLH@DAHFLBN@D?BDD?@DH?D@L?DKAKBEBMDGCA@GAC?GBIDE?GHEJQDOLMFALS@MAKJUHGHCDK?CDIDCDOV]H?CI?GCG@ADFBNBHDBNOL]@@GTKRO^GHEJQTB@?LWPCBERBBARGVQJKVEPIH[P[\\IDCD?FJDOFCFGHI?SESAQEIAGCQ?GCKAGEG??D@H?JBDBTHTJXP\\PTTXRP\\PRNTVBHBDLFDFD@BLDFBJFFHVAJKDADDJAD@HEJIREBCH@RCN?^CHDLFLJJh@PTTF@LNFB@LINCH?DC?@R@FCB@FHFNDVJFDAFC@@HBN@NDHPJFHDHHLVTLJLFTFH@@BJAHBTCJ@F?TFN@JFH?FEDAHG?@BCAKFMEC?MJSHONYLOFMBSDMD]?W@KFGHOJWBMNQ@O@KCQEQAIEQCGKKEIAM?KDEHW?CEGHa@HKACFUNSRSLQJS?ECEEOCMBCEUCOFKHCBIBA?ERFFAFDNAHKFMLM^?NBNB^JJDPDPEF?LCJ?VBLDRFHARGPOPIJMDALGHIBG@MHKFGHE@I@CDAJIF?BE?CDCBSAGFOHEGCIMCI@KEICQBS@IAIBIJGAQGEEI?EEMKMEAEK?IGMKEMSIGQAOMIEOOBYGOAKKKSIOGMSEMM?KHSASBG?SIUCKGSEa@C_@AIBSGS?GBM?UIMB?HOGABHH?HEB@PJHAHK?CHGBWDGAOBYFIPQB[FUHICIIDOEGOIKA[BEFG?EBS@EDY?SD[FOEGEQAMBEHCGODO?ICEE@AEICMAEGOIM@OCGDIGGJ@PCLJ\\@NITABFLBRKT?JSLIIOJIUQ]AGMe@@WKWEa@?a@L[FWCQ@WIAIBKJGJADEXQVGNIMCOOHG[G?EPBN@JDR@ND?JIDSABFTBXHJCCGREACSGDC^C?GR@DJNL?DHBDABVJFDLEJAFQDBBV@FDNHFGACLAH?VBMJH@J?HIBBEJIHFBIHID?HPCEHJ@GPL?NGFOBMPS?EBA?CJG@GAMAEDEDEHCPEJGPENMCAHG?GJADFDE?GCANANDAH@DEHQHINUNO?EDDB_@JQHABBFJINAFJMF@HH@HNF@?ECKCCLSFCDGJCHGLANGPMLIDSHANGHBJFF@PJd@E\\D@J?JPLXB@DJJFNGJJFBLLBLLX?R?JFFFHADGDIRCFDHCH@CO@KHABEAMGG?GCK?GBE?G?MFG[MW@[?UBOA_@@IKCg@RUNI\\G@MYCa@DDWQHm@OEOa@GIEQ][GO?CCO?CBMIBG@KFI?SCECEQAGCOE@HBDADI@BFDANLEH?FSB?FUCIEUFIDME_@GWGSBADS?CI[EBO?OIKQGONO?COAKD@LE@KYEYASBUAUIRIb@@b@D^DJKRECSFQGKQKm@UMC@GZI`@DRLCJ^Nf@PLZMLSHPTTDF`@HPVAJNV?DQNUN]JKf@VZBXIFUDm@QKu@Qe@Se@[o@e@_@Ow@Wk@I_@@]Oe@?c@C}@LXDUJSEa@Ju@BkAVOF?LTH^DxAOLB_@LAH?RYDOBAGJIMEo@JOEJMm@SQ@SDIMNKIKLKw@FIHV@?JMD_@CCKi@IeAQO@RJW@MEe@A]GUJWKTKKGy@F[DgATMIRI@EVAGGJO?Ec@QMQMCu@BCJRNMDELBZUJHLd@ZU@GEUEEIQIJIGMTABIOSXOc@MBMIAIJFRU@HMa@Gi@?c@JPQ@Sa@Eq@@i@ANKWKU?g@Is@CECu@AOBk@Ie@?CISGo@Ga@DZDm@@CHSCy@?k@HOFBHTDr@HNDWB]BQCILIE_@C_ABCHsA@AMi@@_@?_@JIJJFWN_@FSS_@Fa@Ee@FMEa@@NQ[GsDJQJs@NoACg@@OF@NWD[Cc@Ac@Be@Ac@PWENMIG}@Di@Ay@H","noBcj@q@Ns@R@JMDDOu@Bg@PRH^@@PFBP?NEXEBIRAV@HECGVBIHJF","|uAmj@_@HS@QGWE]@]G_@EMFMCEIM@_@P[MANWCGEW@_@Fm@F[BSAYHZHc@Bu@AQCSJUIRGKGW?QAOBSJUAa@H_@C]?BKQC_@F?PKOO?ISTKVGAUWMY@SH[TPHe@B?RYOWLDLSLSMMQAU[@]@YHAHNJMH@Hd@LZ@TEDHPPDFVLZ@NF@JTBXNRTFN@V]@GRIL[Ce@FSFMHWDUF_@@U@@NERMT]ROEIUH]LK_@GUMKM@MLQVMWUHQD]MEa@DS@QCQDWJEFc@??PEVQBMJ]KSUKGOPYVUVFLYHQJ_@DMDGNMBGDAVZL`@DVP`@@j@C\\?R@NLXF\\ZTPOC_@Yi@O]AQHPJETENYHa@CSU?LMFVJl@JPFVNLA@Qc@O^?TBADRHTDRDLN?JEHG?@EEB@DJ@H?NBR@ND]CEBZDL??CDDE@BLLN@EB?DECHCB?FDFHN@AEKHGBO@FCJLAMD?PE@ADCRLNRDLJH?HF@DTLJHFJBLCLENIL?HGT?TDJD@HA@GFER_@BGCMBINOFCRHBAHIJCT@PAN@F@CD?FCBB@FAFBL?LKP@LCJ@PBPNRFHHDF?LAHCDFPBL@Z@HCHEHCNMLCJGHUBGHQEMA[GKGEK?OCEMEUCO?K?EB?HJHBLC@FVDCB??@C@?BBHA@@FA@BHBB@@BDEBACGBCCE?M@I?GCK@GAKBKFG@EDBDAFBD@F@HAL@@@F?DBBADABEHGFON?BG?A?EBIAGCKCEEK?@@K@GBMHK@MMGA?GCOKIK?ACO@WOGGG?EDBD@DH@EF?JHHGNG?EOFE?OWG@GGGELM@MH?DQ@UAIFO@KE?CWAW?NDEHO?OHANI?UJKL?HG?SNWBACO?SBUFUNAFG?CJK`@IBALNNEDc@@?ROKWDa@LIHBJWEe@H]?]NYTMDQ?GFIb@F`@HJZZLVLND@DLAd@Fj@DFBXRX@RPHBJT?\\FNFTDTNPR@LAJBRBHLHTb@PNLFFRLJFJTJNCH@PIL@JK@HYPBLMF@HPX\\Hf@BTACJBNCHJDTBPGFDARMDIGEJPDNJ@RDHP?NJDLSLSBFPVJJVPFFFETKJFAP?FBPFBPF@VGTMVIFMEKHK@a@GSUO\\EQOEa@WFIi@LEDXJCE[Ee@IKDS@UGAK_@M_@I]D]EO@WKYCe@Ei@Ek@@_@B]RI@Gd@Sb@UNMFOAENYRc@Pg@FIFMLMNGGGHSEMOKIMBIFHJICC@QECCKGM@GKCKG@EGA@IEEIAOUFECKBQCCBQFIDEBKCCBABEHEH@BDFDB?@BIJFBH@BK@BDABGFADAF??BBAHCBEAA?EDCLE@EDCADBBBCFA@C?EAGBACCNMBEHGHGACE@BEDA@DJADAHCH?DCHCJ?HCHGVUHENEJ@NDH@LCLCPINATIPGBEJAREFGTKHKBIEA@ECE?EDI@GDIPSRMHMPG@CAKHEJIBMJ?JKFI@EHMFOAGNGD@JE@FAHALGFSRCFA?CJEDEDKHERKP?HI?OP?BHF@?DKJKNIHC?O@IVO@BBELCJKAAG@GG?ILMJEVg@FQBIJKHA@EJADCRABC@KRSN[?CHELQBOHICO?QDOGQCc@B[DODIAC]FIPEEBODOB?d@SLGb@GJQCKXIBOVM?IJGPEBQXOJQPA^?VEh@St@KZ@d@IVGTBCLJ@TBPDTBBIISUEDEXJLJZLMHPNTFRDDF\\HDHVFL?PBRFPD`@D@CUGQEUKWAIG[KCCOGAMKKVDDCJFJIDDFIRFJ?@KCEJGXBPIJC@KLGGKOIEIOAM@OGO?MEBGHCMGJ?TBDDLE\\BZEFGXK[Gk@IO?@Hi@?NKVGLIRGZGKIc@?WIEISGSAe@IQ@]K]DOFGCa@@@B_@BSAi@De@@O@YC]D","ns@af@OGY??BVHL?","zp@ol@TIAGGAm@@c@J?Dh@ATB","|p@_f@G?CBFJFADE","ny@{m@JFZAVCII[CQD","ry@mo@H?d@ABCg@?MB","n{@gp@WFBD\\DNEHG?GY@","`v@om@`@Ar@EFK@IRGh@ATGGGg@@UDg@?QDDFWDKB[?[@_@Cg@Aa@@SFEFLBZDXCx@B","pdA{o@[BDDd@DZEOG","jdAgp@YBVB^??CSE","`b@u^LPMEKBDDQDGESFDLMCAHGLHNF@LCCOBCVPJ?MIRCR?f@?@EKGFCOKS_@MKOEI?","ls@ug@UDWD?HOAMFPD\\EJGRHZHFIX@OICOEQM?CHIC","fp@gl@SGk@J[FAHe@ESLo@FQFQPb@Hm@J_@D]P]?DL`@VVG^SX@@JSJ[HGBKRDLXCp@O[NUJAFt@Gh@KVIEE\\IZI?Dx@BPGMMe@?g@CDEGIWSBGFG\\Ih@EMCTMP?NGHDb@BfAEj@E^ANGSGZ?DSOQSGs@ENJOLQOs@Ia@TBJ","`z@im@i@?e@B\\PVBTNTAJO?III","xkAqn@a@Oi@K]?[A@LNFP?d@F^B","|qAw`@SAFTQNF?JGFIHE@I?E","|`Aqp@g@@u@FMHGF^A^El@ASEVC","dlAi]H@`@GDGNEBETCDI?Ea@FQ@QNSF","|jAom@[Bq@?SDUFXDn@LXL?Fr@HHGl@KUUQMRK","jbAkn@QCS?CHJHbA@p@H\\?BEi@IxABZC[SQEw@Fc@Ja@?ZQQGS@GH","paAul@UFKRELa@Hc@H@F^@KFDDb@Ab@ET@d@Dp@Bb@@JIXEP@VOKA_@A[?YCd@Cj@@Z?HGm@G^?`@EOMMGu@KSBHFm@EYHWIQFOPIGLSQA","v}@ml@TMUGWBc@CEDRH_@FBP`@FPALEp@O?E","raA_m@Y?OBPJ\\M","p|@}n@OF?JHL^@TC?I^?@MU?]E[?","~z@kq@MESAFCm@AYJa@B_@BOJWFZDb@Lb@@h@ATIAEOEd@?TEJI","fx@er@]CW?e@C]GW@UDOKYAc@A{@AK@y@AkCBi@@c@D?Bn@Hp@BPBk@?l@J`@D`@Nf@BLBz@@[@LBOHPD^DHFZDCBa@??Bt@Jr@Ex@B\\Ad@A@Ic@CHMMAs@HXM`@COGc@CEEZGFKu@@O@_@Gl@AdA@b@GNGVE","~m@ci@LDT?BIGIQCOD?F","vz@ej@LDXEN@ZGQEMG_@F","hg@e^EAYDUF?BH?XE","~f@k\\EHO@Q?HFF?VGDE","~_BoKGH??LFBBBC?CBGCE?CA?","n`B_L@BD?DEAAE@","vaBqLEF??F?BE","rbB{LABB@DCCA","`gBwd@O@AFJ@JALE","v~Agc@K@IDPHRFHEBIQE","hjB{f@KBKAODS@@@LBNCFCP@BA","cwAr@a@Le@JMHIHCJ_@JEHP@CLQJKTK??FMBDBUF@DL@BEd@ENKHKJOXINDJDANNDHATAPORCBDX?GOMEDUHOd@QN?\\SDHF@BG?GNIUEM?@E\\?FKPCFI[CIE_@FAFE^UJOUUKQ?QFMD","k~AhAGDAHDDBKBGROLECCKDMF","q}ArBTHH?NEJEAEQBIACIA?AHK?EGIE@KKACB?JDJH@","w_BhBEDGJID@DD@FGHKBOCA","emAzDLLND@CAEGKSGACOEM?GAE@DDTF","{rAhC@OGMCD?H","egAkBMMIOG?IHAFKDQD@FL?CHLFJPMP@HUPV@DL?PPL@RF\\@ETFFKLAHEVFFIL?NA@YHEHO@QAQKMMDOCCOGCWCMOIKGG","{oAv@UDENNIN?J?L?CK","inAjALCBGSACF","}nAk@AJK@AF@NHA@LGHD@FKDYCO","ykAQW?SMABNRLBRC^?PBBLQPKGc@G?HHCFJPFSXBDQV?JJDFEIORFBEAGLKASLDAV?ZJBFEEQBSF?DMGMAMI_@CGQMOD","ejAlEXMQCIDGD@B","yjAhDM?QG@J\\BZA?GOC","}hAfDKACFb@DJ?GIIAEE","ybA~BAFe@@EGc@FGL]BWJTFTIP@TAPCVGLAFBb@GBIP?MSW@OD","g`ATALGHM@ILBV@^T?NQXOFKNOHMN[NQDOFOPMHONKRU@IK@_@BQPMLKFQTU?OLKNMHFNKF","zi@z_@EHILYL[BFHR?HEDFNDTANERAXKRIZWQB[LYFIIEMSG","xk@gJLCF@LAFBJEAGSBM@GEHG?GJACEK?QBACO?KDC?CDK?@DI?IFFFHCF?F?@BF?BCD@FLDC","sy@sq@i@Eg@Jm@PDPh@@v@C`@GNMXC","g_Aqp@s@JDFpBFe@YOA","wuAqn@u@?gAHNNhA?^Bf@MIK","s{Aan@q@BTF^Ad@GEE","mvA{l@QGYA[FAD\\?h@A","_[kq@g@C]?CDKEQA]BFBj@B@@VBTCKG","m`@cm@o@ODIm@IaAMaAAa@Gg@AMFLDfAHz@F|@R\\R^PCPe@NJ@~@CDGb@E@ISC@Kg@O","ixAq`@GR@PGTU`@\\EJZQT?LNKJLBOAS@UCMA[JQA[QIFGIC","noBuk@AAQ?[D@BRBX@","jp@wOIAM@?BTB","ro@{OOFBLBAAIHG","zo@wNE?GP?HD@BKFE","fe@j_@WIOBMGOFDFZDFGPH","mHyp@GE]AYF_ALp@FHNPBHNV?h@KQE\\Ef@QNOw@EID","cPaq@\\Jx@@x@CBCZATG}@E[BSEq@D","mNuo@j@Hb@EMCJGi@CGF","f\\sr@cAKeA?YEeAA_D@}BNd@FjA?jB@IBeAA}@De@EOFTHs@E_BG{@BKFpALHD~@@m@@VLNJ?VWJ\\@`@De@HCPT?YPj@@WFFDZBZ?YL?Ff@GHD[BYJEN`@BNGVIEJVJu@?[@t@Nt@Nz@FT?RFZRj@LJ@ZBZBPL?LHJ^NGNRb@Z@\\Qf@?PILS`@WHMBQZQGMLGSW]EGGCO`@HP@VE@MGIS?g@Br@QR@NEUQJGf@a@XG?Gt@Kh@At@@n@?VE`@Ks@Eg@ArACl@GAGkAIiAIGGt@EQGcAM]AFIm@C}@C}@?UDs@Io@D[@i@Dn@I","aj@j]MDQBABDF^@?K","mDsYMGCNFNFCDM","lh@qJI@CBBBN?J@?IAA","`o@oJIBCDL?DBJCHEAEG?","lr@oMQ@O?QDGFSAEB]TE?KB@DO?MF@BLBJ?LA\\@MIFEJ?FEBKJ?PCDCXCFCGCRALHF?BDF@HAKECGGCICOA","}]xFEFELAVEF@HBDDKBDCN@FDB@PFTHZJd@FZFTNDPFZKBI@QFO?MAOIA?GIMAMDGBM?QEIAMI?KCGCG?KKOKEI@GG@IMAKEI","ogB|HKJD@DG","ggBxH@E@OIDCNDA","mOaU@D\\@?CVCCGIDO?O?@B","zBu`@CLNPb@JZAOUHS[OMGQASJ","sfBdLOJIHFBHELGLKJMBEI?IF","idBpEEDL?FKKB","adB~DBBLQBKE?GN","qcBdEF?JADCAGMBEB","wbB~CED?BNGHEFGCA","eaBjCGDB@FCFG?C","_mBxXNF@EFAIODKTGAGMEAO?KFM?CHGLQHMG?KHMDEPMRAMGDCNODK@KGI@BPDJNADDAH","aiBfZOKKIIMGEAIMIGNOGCF?HDFLNHFGHN?NDDLJRXLP?JETABEIOYSKC","i{AnXK@AVFD@NDELLB?LAJO@MJO?IM@SD","ymAbSRHPDBHDFP?J@PCL@L@JHD?HBHFLAL?RKJC?KIACC?GAM@KHSBK?IFM?EFGBOHOBGIFFQIDEF?IHO@EBEAKCCAI@KGMALGMQEGGOGIAC@OEKACEE?I?UEIIEIIIAQMQGPICFIEIIBAMIIEGIC?EG@?CSEMHKJK?K@BKIOGC@EGKKEI@QC?INEKCKDKFOBEAKDKCG?CAIHDHFFD?AFDHFHADOJODIDMJE?IDCDQDMEGSAKEO@G?E@KCOAC@ECICK?EGEEHAJC@AFEHAJ?FELMEEFIF@FEZE@EP@HELUHYP@BKLGRGCGHCCCTWRONCNAH@LIN@PBHBP?HBLHRLFFNDHDPFHBLBLADJFT?PFHFJFNGJCAIHBPLZGJAREJKBOBIHGRAEIBMHLPBKKAKGI@MNPJDFNNG?KJMHGCCXKL?RIb@@n@L","cr@uCBRFDPBFOB[G_@MHIL","mcAkJNE@QIGUEK?CFFFDJ","ckAgNJ^HNHO@OKQOOID","uH{VDNADBHNGHAZICIU@","mDqXIEKL@XH?FDFE?WBK","wFab@EHJNTK@G","|@k`@CKLKVCDEGGDEJH?SJIGSOOO?W?TRSAU?BNPPS@SXM@KVEFWB@JJDGHPHX?`@DHCJHPALDJC]SQC^CDGUEJICM","`Hqh@BLULXLx@LPBpAISGj@Ic@C?Eh@CKM_@A]L]KYD_@I","ojA}FHOQ@EDBP","wkAmEAKK?BJOQ@PFFDJDDJM","anA{C?JDPFSFHENDFVKDMEIJGDFHALJBEGOKEKGEHOECIM?@OOH","aiAyDXPIMMKKMISCNLJ","mkAkJ@FELBNJFBNCNK@GAYH@JEB@HNIFKBFLKPBHEAGECDE@FHKBG?SGFA_@EQK?KDEE","gkAcF@IKDK??FHHJD?I","mmAsFEVNE?DEJHD?MDABKK@?GJOQ@","uwAoWPR?TFNCHHLXFb@@ZTLE?Ob@BTHV?SNL^JHHGCQJEFMSEIKSKMKg@EUBSc@MHg@[MWBWGKUCIZ","kyAoZMGCTZDPR^MHTT?BSIMUAE[EOUTOD","wqA}SIKKBGIMDCDJJFEHBDJJE","oS}TAEO?QELHABRFHABG","pe@wEKAC??NP@BAEE"],"visited":{"124":["vkAs]B?d@SLGb@GJQCKXIBOVM?III?K`@M`@c@PIJGJIRDRJNMLGRER??qB?iAe@B_@HS@QGWE]@]G_@EMFMCEIM@_@P[MANWCGEW@_@Fm@F[BSAYHZHc@Bu@AQCSJUIRGKGW?QAOBSJUAa@H_@C]?BKQC_@F?PKOO?ISTKVGAUWMY@SH[TPHe@B?RYOWLDLSLSMMQAU[@]@YHAHNJMH@Hd@LZ@TEDHPPDFVLZ@NF@JTBXNRTFN@V]@GRIL[Ce@FSFMHWDUF_@@U@@NERMT]ROEIUH]LK_@GUMKM@MLQVMWUHQD]MEa@DS@QCQDWJEFc@??PEVQBMJ]KSUKGOPYVUVFLYHQJ_@DMDGNMBGDAVZL`@DVP`@@j@C\\?R@NLXF\\ZTPOC_@Yi@O]AQHPJETENYHa@CSU?LMFVJl@JPFVNLA@Qc@O^?TBLK?[FELBDCNLDNFFFBD?@DbA?FBVNDFd@?H@CBAFXHTBTHD?DA@ECEIKEKHa@RIAC@AD?BC?CB@D?AADA@E^Md@MPDD?VENBRGRALADABKF??F","ns@af@OGY??BVHL?","zp@ol@TIAGGAm@@c@J?Dh@ATB","|p@_f@G?CBFJFADE","ny@{m@JFZAVCII[CQD","ry@mo@H?d@ABCg@?MB","n{@gp@WFBD\\DNEHG?GY@","`v@om@`@Ar@EFK@IRGh@ATGGGg@@UDg@?QDDFWDKB[?[@_@Cg@Aa@@SFEFLBZDXCx@B","pdA{o@[BDDd@DZEOG","jdAgp@YBVB^??CSE","`b@u^LPMEKBDDQDGESFDLMCAHGLHNF@LCCOBCVPJ?MIRCR?f@?@EKGFCOKS_@MKOEI?","ls@ug@UDWD?HOAMFPD\\EJGRHZHFIX@OICOEQM?CHIC","fp@gl@SGk@J[FAHe@ESLo@FQFQPb@Hm@J_@D]P]?DL`@VVG^SX@@JSJ[HGBKRDLXCp@O[NUJAFt@Gh@KVIEE\\IZI?Dx@BPGMMe@?g@CDEGIWSBGFG\\Ih@EMCTMP?NGHDb@BfAEj@E^ANGSGZ?DSOQSGs@ENJOLQOs@Ia@TBJ","`z@im@i@?e@B\\PVBTNTAJO?III","xkAqn@a@Oi@K]?[A@LNFP?d@F^B","|qAw`@SAFTQNF?JGFIHE@I?E","|`Aqp@g@@u@FMHGF^A^El@ASEVC","dlAi]H@`@GDGNEBETCDI?Ea@FQ@QNSF","|jAom@[Bq@?SDUFXDn@LXL?Fr@HHGl@KUUQMRK","jbAkn@QCS?CHJHbA@p@H\\?BEi@IxABZC[SQEw@Fc@Ja@?ZQQGS@GH","paAul@UFKRELa@Hc@H@F^@KFDDb@Ab@ET@d@Dp@Bb@@JIXEP@VOKA_@A[?YCd@Cj@@Z?HGm@G^?`@EOMMGu@KSBHFm@EYHWIQFOPIGLSQA","v}@ml@TMUGWBc@CEDRH_@FBP`@FPALEp@O?E","raA_m@Y?OBPJ\\M","p|@}n@OF?JHL^@TC?I^?@MU?]E[?","~z@kq@MESAFCm@AYJa@B_@BOJWFZDb@Lb@@h@ATIAEOEd@?TEJI","fx@er@]CW?e@C]GW@UDOKYAc@A{@AK@y@AkCBi@@c@D?Bn@Hp@BPBk@?l@J`@D`@Nf@BLBz@@[@LBOHPD^DHFZDCBa@??Bt@Jr@Ex@B\\Ad@A@Ic@CHMMAs@HXM`@COGc@CEEZGFKu@@O@_@Gl@AdA@b@GNGVE","~m@ci@LDT?BIGIQCOD?F","vz@ej@LDXEN@ZGQEMG_@F","hg@e^EAYDUF?BH?XE","~f@k\\EHO@Q?HFF?VGDE"],"276":["yGs`@EJDBEFEH@FGJF@DABBNBDBNBCDAHIBKFFHD@AL@@DCH?LBPA@DHED@TEBBN?AMIMZCHE?GBCCMBUK?CEEQBGCCO?CBMIBG@KOBKC?FSB?FUCIEUF"],"380":["oEi\\M@AASCCD[D@HCFNANDAH@DEHQHINUNO?EDDB_@JQHABBFJINAFJMF@HH@HNF@?ECKCCLSFCDGJCHGLANGPMLIDSHANGHBJFF@CGJCDMGEDG?EIBI?IGCBI?CGM@IC","uH{VDNADBHNGHAZICIU@","mDqXIEKL@XH?FDFE?WBK"],"392":["uwAoWPR?TFNCHHLXFb@@ZTLE?Ob@BTHV?SNL^JHHGCQJEFMSEIKSKMKg@EUBSc@MHg@[MWBWGKUCIZ","kyAoZMGCTZDPR^MHTT?BSIMUAE[EOUTOD","wqA}SIKKBGIMDCDJJFEHBDJJE"],"484":["dhAiSUAYA@B]Hm@Lw@??Ia@?GFIDKHEHCHKDODKOO?MFILGJKJCLEFODMDGAFPBL@Z@HCHEHCNMLCJGHUBGHQEMA[GKGEK?OCEMEUCO?K?EB?HJHBLC@FVDCF?DJBA@Bd@??HH?GFGBABC@@DV?HNAB@D?DVUHENEJ@NDH@LCLCPINATIPGBEJAREFGTKHKBIEA@ECE?EDI@GDIPSRMHMPG@CAKHEJIBMJ?JKFI@EHMFOAGNGD@JE@FAHALGFSRCFA?CJEDEDKHERKP?HI?OP?BHF@?DKJKNIHC?O@IVO@BBELCJKAAG@GG?ILMJEVg@"],"704":["e`AqEQGSAFKa@MAWBMCSDMLM\\i@VKEEKEFQV?FQJOICO?SAOKIFQB@JGFSBXPNPBLa@n@QJKNGd@@`@NLVJNPVPFKEM"],"840":["vkAs]gP??GG?CJE@M@S@SFOCWDE?QEe@L_@LADE@@@E?CA?BCBE?A@@BSHI`@DJHJBDADE@E?UIUCYI@GBCIAe@?EGWOGCcA?AEE?GCGGEOOMEBMCGD?ZMJADRHTDRDLN?JEHG?@EEB@DJ@H?NBR@ND]CEBZDL??CDDE@BLLN@EB?DECHCB?FDFHN@AEKHGBO@FCJLAMD?PE@ADCRLNRDLJH?HF@DTLJHFJBLCLENIL?HGT?TDJD@HA@GFER_@BGCMBINOFCRHBAHIJCT@PAN@F@CD?FCBB@FAFBL?LKP@LCJ@PBPNRFHHDF?LAHCDF@LENEDGBMJKFKHMLGN?JNNEJEBIDIJIHEFG`@??Hv@?l@M\\IACX@T@BIJKHA@EJADCRABC@KRSN[?CHELQBOHICO?QDOGQCc@B[DODIAC]FIPEEBO","~_BoKGH??LFBBBC?CBGCE?CA?","n`B_L@BD?DEAAE@","vaBqLEF??F?BE","rbB{LABB@DCCA","`gBwd@O@AFJ@JALE","v~Agc@K@IDPHRFHEBIQE","bwAqj@?hA?pBS?SDMFOLSKSEKHKFQHa@b@a@L?JHHJGPEBQXOJQPA^?VEh@St@KZ@d@IVGTBCLJ@TBPDTBBIISUEDEXJLJZLMHPNTFRDDF\\HDHVFL?PBRFPD`@D@CUGQEUKWAIG[KCCOGAMKKVDDCJFJIDDFIRFJ?@KCEJGXBPIJC@KLGGKOIEIOAM@OGO?MEBGHCMGJ?TBDDLE\\BZEFGXK[Gk@IO?@Hi@?NKVGLIRGZGKIc@?WIEISGSAe@IQ@]K]DOFGCa@@@B_@BSAi@De@@O@YC]D","hjB{f@KBKAODS@@@LBNCFCP@BA"],"056":["{Bw^BLB?@JPIH@LIHGF?BEOCM?SCKH"]}} /* DATA_END */;

  var THEMES = {
    light: { bg: '#ffffff', text: '#1b1f24', muted: '#6b7280', accent: '#1f5fd6', accentRGB: '31,95,214', textRGB: '27,31,36',
             seaHi: '#f4f7fb', seaLo: '#e2e8f1', land: '#c3ccd9', coast: '#9fabbd', grat: 'rgba(27,31,36,0.12)', night: 'rgba(16,28,64,0.13)', term: 'rgba(16,28,64,0.2)', shade: 'rgba(10,20,50,0.14)', flatSea: 'rgba(31,95,214,0.06)',
             home: '#3d7ef0', hot: '#5a95ff', edge: '#143f94', rim: 0.6 },
    dark:  { bg: '#0f1115', text: '#d5dae2', muted: '#8b93a1', accent: '#7cb3ff', accentRGB: '124,179,255', textRGB: '213,218,226',
             seaHi: '#182030', seaLo: '#0d1119', land: '#39424f', coast: '#525c6c', grat: 'rgba(213,218,226,0.1)', night: 'rgba(0,0,0,0.34)', term: 'rgba(124,179,255,0.18)', shade: 'rgba(0,0,0,0.28)', flatSea: 'rgba(124,179,255,0.06)',
             home: '#a9ceff', hot: '#c6ddff', edge: '#2d64b8', rim: 0.7 }
  };

  var CSS = '' +
    '.passport-atlas{display:block;max-width:100%;position:relative;box-sizing:border-box;font-family:inherit;font-size:13px;line-height:1.4;color:var(--pa-text)}' +
    '.passport-atlas *{box-sizing:border-box}' +
    '.passport-atlas .pa-maps{display:flex;align-items:center;gap:14px}' +
    '.passport-atlas .pa-maps.pa-stack{flex-direction:column;align-items:stretch;gap:10px}' +
    '.passport-atlas .pa-globe-wrap{flex:none;position:relative;display:flex;justify-content:center}' +
    '.passport-atlas canvas.pa-globe{display:block;border-radius:50%;touch-action:pan-y;cursor:grab;outline:none;-webkit-tap-highlight-color:transparent}' +
    '.passport-atlas canvas.pa-globe.is-dragging{cursor:grabbing}' +
    '.passport-atlas canvas.pa-globe.is-pointer{cursor:pointer}' +
    '.passport-atlas canvas.pa-globe:focus-visible{outline:2px solid var(--pa-accent);outline-offset:4px}' +
    '.passport-atlas .pa-side{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:8px}' +
    '.passport-atlas canvas.pa-flat{display:block;width:100%;height:auto;cursor:default}' +
    '.passport-atlas canvas.pa-flat.is-pointer{cursor:pointer}' +
    '.passport-atlas .pa-label{font-size:12px;line-height:1.35;color:var(--pa-muted);min-height:2.7em;overflow:hidden;text-overflow:ellipsis}' +
    '.passport-atlas .pa-label b{color:var(--pa-text);font-weight:600}' +
    '.passport-atlas .pa-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0}' +
    '.passport-atlas .pa-chips a.pa-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 6px;border:1px solid var(--pa-line);border-radius:999px;color:var(--pa-text);text-decoration:none;font-size:12px;line-height:1.3;background:transparent;transition:border-color .15s,background-color .15s,color .15s;-webkit-tap-highlight-color:transparent}' +
    '.passport-atlas .pa-chips a.pa-chip:hover,.passport-atlas .pa-chips a.pa-chip.is-on{border-color:var(--pa-accent);background:var(--pa-accent-soft);color:var(--pa-text);text-decoration:none}' +
    '.passport-atlas .pa-chips a.pa-chip:focus-visible{outline:2px solid var(--pa-accent);outline-offset:2px;border-color:var(--pa-accent);background:var(--pa-accent-soft)}' +
    '.passport-atlas .pa-chips a.pa-chip svg{width:18px;height:12px;border-radius:2px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,0.14)}' +
    '.passport-atlas .pa-chips a.pa-chip.is-home svg{box-shadow:0 0 0 1px var(--pa-accent)}' +
    '.passport-atlas .pa-foot{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin-top:10px;font-size:12px;color:var(--pa-muted);line-height:1.4}' +
    '.passport-atlas .pa-foot b{color:var(--pa-text);font-weight:600}' +
    '.passport-atlas .pa-foot .pa-stats{flex:1 1 auto;min-width:0}' +
    '.passport-atlas .pa-foot a.pa-more{color:var(--pa-accent);text-decoration:none;white-space:nowrap;margin-left:auto;font-weight:500}' +
    '.passport-atlas .pa-foot a.pa-more:hover,.passport-atlas .pa-foot a.pa-more:focus-visible{text-decoration:underline}' +
    '.passport-atlas .pa-foot a.pa-more:focus-visible{outline:2px solid var(--pa-accent);outline-offset:2px;border-radius:3px}';

  function ensureStyle() {
    if (document.getElementById('passport-atlas-style')) return;
    var st = document.createElement('style');
    st.id = 'passport-atlas-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---- flags: eight small SVGs drawn from simple shapes (viewBox 0 0 3 2) ----
  function starPts(cx, cy, r) {
    var p = [];
    for (var k = 0; k < 10; k++) { var a = (-90 + k * 36) * Math.PI / 180, rr = k % 2 ? r * 0.382 : r; p.push((cx + rr * Math.cos(a)).toFixed(3) + ',' + (cy + rr * Math.sin(a)).toFixed(3)); }
    return p.join(' ');
  }
  function leafPts() {
    var raw = [[10,1],[11.6,4.3],[13.7,3.3],[12.9,8.1],[16.6,6.2],[15.8,9.2],[19,11.3],[14.5,13.7],[15.3,16.2],[10.8,15.2],[10.8,19],[9.2,19],[9.2,15.2],[4.7,16.2],[5.5,13.7],[1,11.3],[4.2,9.2],[3.4,6.2],[7.1,8.1],[6.3,3.3],[8.4,4.3]];
    return raw.map(function (p) { return (1.5 + (p[0] - 10) * 0.062).toFixed(3) + ',' + (1 + (p[1] - 10) * 0.062).toFixed(3); }).join(' ');
  }
  function usStripes() {
    var s = '', h = 2 / 13;
    for (var i = 0; i < 13; i += 2) s += '<rect y="' + (i * h).toFixed(3) + '" width="3" height="' + h.toFixed(3) + '" fill="#b22234"/>';
    return s;
  }
  var FLAGS = {
    '704': '<rect width="3" height="2" fill="#da251d"/><polygon points="' + starPts(1.5, 1.05, 0.62) + '" fill="#ffd400"/>',
    '840': '<rect width="3" height="2" fill="#ffffff"/>' + usStripes() + '<rect width="1.2" height="1.077" fill="#3c3b6e"/>',
    '484': '<rect width="1" height="2" fill="#006847"/><rect x="1" width="1" height="2" fill="#ffffff"/><rect x="2" width="1" height="2" fill="#ce1126"/><circle cx="1.5" cy="1" r="0.27" fill="#8c6a2b"/><circle cx="1.5" cy="1.17" r="0.1" fill="#4a7f3a"/>',
    '124': '<rect width="3" height="2" fill="#ffffff"/><rect width="0.75" height="2" fill="#d52b1e"/><rect x="2.25" width="0.75" height="2" fill="#d52b1e"/><polygon points="' + leafPts() + '" fill="#d52b1e"/>',
    '276': '<rect width="3" height="2" fill="#000000"/><rect y="0.667" width="3" height="0.667" fill="#dd0000"/><rect y="1.333" width="3" height="0.667" fill="#ffce00"/>',
    '380': '<rect width="1" height="2" fill="#009246"/><rect x="1" width="1" height="2" fill="#ffffff"/><rect x="2" width="1" height="2" fill="#ce2b37"/>',
    '056': '<rect width="1" height="2" fill="#000000"/><rect x="1" width="1" height="2" fill="#fae042"/><rect x="2" width="1" height="2" fill="#ed2939"/>',
    '392': '<rect width="3" height="2" fill="#ffffff"/><circle cx="1.5" cy="1" r="0.6" fill="#bc002d"/>'
  };
  function flagSvg(id) { return '<svg viewBox="0 0 3 2" aria-hidden="true" focusable="false">' + FLAGS[id] + '</svg>'; }

  // ---- maths ----
  var TAU = Math.PI * 2, RAD = Math.PI / 180;
  function haversine(a, b) {
    var dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrap180(d) { return ((d + 540) % 360 + 360) % 360 - 180; }

  // sun position (same model as the full page)
  function sunPosition(date) {
    var n = date.getTime() / 86400000 - 10957.5;
    var L = (280.460 + 0.9856474 * n) % 360;
    var g = ((357.528 + 0.9856003 * n) % 360) * RAD;
    var lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    var eps = (23.439 - 0.0000004 * n) * RAD;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    var gmst = (280.46061837 + 360.98564736629 * n) % 360;
    return { lat: dec / RAD, lon: wrap180(ra / RAD - gmst) };
  }

  // Equal Earth projection (Šavrič, Patterson & Jenny, 2018)
  var A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
  function project(lon, lat) {
    var l = lon * RAD, p = lat * RAD;
    var t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
    return [l * Math.cos(t) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))), t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
  }
  var XMAX = project(180, 0)[0], YMAX = project(0, 90)[1], FLAT_ASPECT = XMAX / YMAX;

  // unit vectors on the sphere, interleaved x,y,z
  function toXYZ(ring) {
    var out = new Float32Array(ring.length * 3);
    for (var i = 0; i < ring.length; i++) { var lon = ring[i][0] * RAD, lat = ring[i][1] * RAD, c = Math.cos(lat); out[3 * i] = c * Math.cos(lon); out[3 * i + 1] = c * Math.sin(lon); out[3 * i + 2] = Math.sin(lat); }
    return out;
  }
  function greatCircle(a, b, n) {
    var A = toXYZ([[a.lon, a.lat]]), B = toXYZ([[b.lon, b.lat]]);
    var d = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1)), sd = Math.sin(d);
    var out = new Float32Array((n + 1) * 3), ll = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, ka = Math.sin((1 - t) * d) / sd, kb = Math.sin(t * d) / sd;
      var x = ka * A[0] + kb * B[0], y = ka * A[1] + kb * B[1], z = ka * A[2] + kb * B[2];
      out[3 * i] = x; out[3 * i + 1] = y; out[3 * i + 2] = z;
      ll.push([Math.atan2(y, x) / RAD, Math.asin(clamp(z, -1, 1)) / RAD]);
    }
    return { xyz: out, ll: ll };
  }

  function decodeRing(s) {
    var pts = [], i = 0, x = 0, y = 0;
    function num() { var r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); return (r & 1) ? ~(r >> 1) : (r >> 1); }
    while (i < s.length) { x += num(); y += num(); pts.push([x / 10, y / 10]); }
    return pts;
  }

  // optional full-detail path: decode the vendored TopoJSON
  function fromTopo(topo) {
    var sx = topo.transform.scale[0], sy = topo.transform.scale[1], tx = topo.transform.translate[0], ty = topo.transform.translate[1];
    var arcs = topo.arcs.map(function (a) { var x = 0, y = 0; return a.map(function (d) { x += d[0]; y += d[1]; return [x * sx + tx, y * sy + ty]; }); });
    function ring(idx) { var pts = []; idx.forEach(function (i) { var a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; for (var k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]); }); return pts; }
    function rings(g) { var out = []; (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []).forEach(function (poly) {
      var r = ring(poly[0]); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r = r.slice(0, -1);
      var top = -90; r.forEach(function (p) { if (p[1] > top) top = p[1]; }); if (top < -60) return; // Antarctica
      var pieces = [[]]; for (var i = 0; i < r.length; i++) { if (i && Math.abs(r[i][0] - r[i - 1][0]) > 180) pieces.push([]); pieces[pieces.length - 1].push(r[i]); }
      if (pieces.length > 1 && Math.abs(r[0][0] - r[r.length - 1][0]) <= 180) pieces[0] = pieces.pop().concat(pieces[0]);
      pieces.forEach(function (p) { if (p.length >= 3) out.push(p); }); }); return out; }
    var land = [], visited = {};
    topo.objects.land.geometries.forEach(function (g) { land = land.concat(rings(g)); });
    topo.objects.countries.geometries.forEach(function (g) { if (VISITED.indexOf(g.id) >= 0) visited[g.id] = rings(g); });
    return { land: land, visited: visited };
  }

  // ---- orthographic view: rotate unit vectors into view space, clip rings to the horizon ----
  var tx = new Float64Array(2048), ty = new Float64Array(2048), tz = new Float64Array(2048);
  function viewRing(xyz, rot) {
    var n = xyz.length / 3;
    if (tx.length < n) { tx = new Float64Array(n * 2); ty = new Float64Array(n * 2); tz = new Float64Array(n * 2); }
    var sl = rot.sl, cl = rot.cl, sp = rot.sp, cp = rot.cp;
    for (var i = 0; i < n; i++) {
      var X = xyz[3 * i], Y = xyz[3 * i + 1], Z = xyz[3 * i + 2], u = cl * X + sl * Y;
      tx[i] = cl * Y - sl * X; ty[i] = cp * Z - sp * u; tz[i] = sp * Z + cp * u;
    }
    return n;
  }
  function crossing(a, b) { // horizon crossing between vertex a (front) and b (back), as a unit rim direction
    var t = tz[a] / (tz[a] - tz[b]), x = tx[a] + t * (tx[b] - tx[a]), y = ty[a] + t * (ty[b] - ty[a]), L = Math.sqrt(x * x + y * y) || 1;
    return [x / L, y / L];
  }
  // Fills a closed ring (clockwise in lon/lat, i.e. interior on the left on screen) into `path`,
  // walking the rim clockwise (increasing canvas angle) between the visible pieces. Returns false if nothing is visible.
  function fillRing(path, xyz, rot, cx, cy, R) {
    var n = viewRing(xyz, rot), vis = 0, i;
    for (i = 0; i < n; i++) if (tz[i] > 0) vis++;
    if (!vis) return false;
    if (vis === n) {
      path.moveTo(cx + R * tx[0], cy - R * ty[0]);
      for (i = 1; i < n; i++) path.lineTo(cx + R * tx[i], cy - R * ty[i]);
      path.closePath();
      return true;
    }
    var s = -1;
    for (i = 0; i < n; i++) if (tz[i] > 0 && tz[(i + n - 1) % n] <= 0) { s = i; break; }
    var segs = [], cur = null, k, prev, c;
    for (k = 0; k < n; k++) {
      i = (s + k) % n; prev = (i + n - 1) % n;
      if (tz[i] > 0) {
        if (tz[prev] <= 0) { c = crossing(i, prev); cur = { a0: Math.atan2(-c[1], c[0]), a1: 0, pts: [cx + R * c[0], cy - R * c[1]], used: false }; }
        cur.pts.push(cx + R * tx[i], cy - R * ty[i]);
      } else if (tz[prev] > 0) {
        c = crossing(prev, i); cur.pts.push(cx + R * c[0], cy - R * c[1]); cur.a1 = Math.atan2(-c[1], c[0]); segs.push(cur); cur = null;
      }
    }
    for (var si = 0; si < segs.length; si++) {
      if (segs[si].used) continue;
      var first = segs[si], seg = first;
      path.moveTo(seg.pts[0], seg.pts[1]);
      for (var guard = 0; guard <= segs.length; guard++) {
        seg.used = true;
        for (var p = 2; p < seg.pts.length; p += 2) path.lineTo(seg.pts[p], seg.pts[p + 1]);
        var best = null, bestD = Infinity;
        for (var j = 0; j < segs.length; j++) { var d = (segs[j].a0 - seg.a1) % TAU; if (d < 0) d += TAU; if (d < 1e-9) d = TAU; if (d < bestD) { bestD = d; best = segs[j]; } }
        path.arc(cx, cy, R, seg.a1, best.a0, false);
        if (best === first) { path.closePath(); break; }
        seg = best;
      }
    }
    return true;
  }
  // Strokes an open polyline (first `count` vertices) where it is on the front side.
  function strokeLine(path, xyz, rot, cx, cy, R, count) {
    var n = viewRing(xyz, rot); if (count !== undefined && count < n) n = count;
    var on = false, c;
    for (var i = 0; i < n; i++) {
      if (tz[i] > 0) {
        if (!on) { if (i > 0) { c = crossing(i, i - 1); path.moveTo(cx + R * c[0], cy - R * c[1]); path.lineTo(cx + R * tx[i], cy - R * ty[i]); } else path.moveTo(cx + R * tx[i], cy - R * ty[i]); on = true; }
        else path.lineTo(cx + R * tx[i], cy - R * ty[i]);
      } else if (on) { c = crossing(i - 1, i); path.lineTo(cx + R * c[0], cy - R * c[1]); on = false; }
    }
  }
  function viewPoint(lon, lat, rot, cx, cy, R) {
    var la = lat * RAD, lo = lon * RAD, cs = Math.cos(la), X = cs * Math.cos(lo), Y = cs * Math.sin(lo), Z = Math.sin(la), u = rot.cl * X + rot.sl * Y;
    return { x: cx + R * (rot.cl * Y - rot.sl * X), y: cy - R * (rot.cp * Z - rot.sp * u), z: rot.sp * Z + rot.cp * u };
  }

  // graticule (30 degree) as unit-vector polylines
  var GRAT = (function () {
    var lines = [], lon, lat, pts;
    for (lon = -180; lon < 180; lon += 30) { pts = []; for (lat = -90; lat <= 90; lat += 5) pts.push([lon, lat]); lines.push(toXYZ(pts)); }
    for (lat = -60; lat <= 60; lat += 30) { pts = []; for (lon = -180; lon <= 180; lon += 5) pts.push([lon, lat]); lines.push(toXYZ(pts)); }
    return lines;
  })();
  // terminator ring (night hemisphere, clockwise in lon/lat) for a sun position
  function nightRing(sun) {
    var la = sun.lat * RAD, lo = sun.lon * RAD, s = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    var e1 = [s[1], -s[0], 0], L = Math.sqrt(e1[0] * e1[0] + e1[1] * e1[1]) || 1; e1[0] /= L; e1[1] /= L; // s x k, normalised
    var e2 = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]; // s x e1  (so e1 x e2 = s)
    var N = 90, out = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) { var t = i / N * TAU, ct = Math.cos(t), st = Math.sin(t); out[3 * i] = ct * e1[0] + st * e2[0]; out[3 * i + 1] = ct * e1[1] + st * e2[1]; out[3 * i + 2] = ct * e1[2] + st * e2[2]; }
    return out;
  }
  function nightFlat(sun) { // night polygon in lon/lat for the flat map
    var ls = Math.abs(sun.lat) < 0.05 ? (sun.lat < 0 ? -0.05 : 0.05) : sun.lat, pole = ls > 0 ? -89.99 : 89.99, pts = [], lon;
    for (lon = -180; lon <= 180; lon += 4) pts.push([lon, Math.atan(-Math.cos((lon - sun.lon) * RAD) / Math.tan(ls * RAD)) / RAD]);
    for (lon = 180; lon >= -180; lon -= 10) pts.push([lon, pole]);
    return pts;
  }

  function resolveTheme(opt) {
    if (opt === 'light' || opt === 'dark') return opt;
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    try { if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'; } catch (e) { /* ignore */ }
    return 'light';
  }
  function scriptDir() {
    var s = document.currentScript || (function () { var all = document.getElementsByTagName('script'); return all[all.length - 1]; })();
    var src = s && s.src ? s.src : '';
    return src ? src.replace(/[^\/]*$/, '') : '';
  }
  var BASE = scriptDir();

  // ---- stats (computed, so they stay in step with the list above) ----
  var STATS = (function () {
    var conts = [], people = 0, far = null;
    COUNTRIES.forEach(function (c) {
      if (conts.indexOf(c.cont) < 0) conts.push(c.cont);
      people += c.pop;
      c.km = c.home ? 0 : Math.round(haversine(HOME, c) / 10) * 10;
      if (!far || c.km > far.km) far = c;
    });
    return { n: COUNTRIES.length, continents: conts.length, peoplePct: Math.round(people / WORLD_POP * 100), far: far };
  })();
  var CAPTION = STATS.n + ' countries · ' + STATS.continents + ' continents';

  // ======================================================================== mount
  function mount(el, opts) {
    opts = opts || {};
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return null;
    ensureStyle();
    var link = opts.link || BASE || './';
    var themeOpt = opts.theme || 'auto';
    var theme = THEMES[resolveTheme(themeOpt)];
    var reduced = false;
    try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
    var alive = true;

    function focusHref(id) { return link + (link.indexOf('?') >= 0 ? '&' : '?') + 'focus=' + id; }

    // ---- DOM ----
    el.innerHTML = '';
    var root = document.createElement('div');
    root.className = 'passport-atlas';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Countries visited: ' + CAPTION);

    var maps = document.createElement('div'); maps.className = 'pa-maps';
    var gwrap = document.createElement('div'); gwrap.className = 'pa-globe-wrap';
    var globe = document.createElement('canvas'); globe.className = 'pa-globe';
    globe.setAttribute('role', 'img'); globe.setAttribute('tabindex', '0');
    globe.setAttribute('aria-label', 'Globe with the countries lit that Jack has visited: ' + COUNTRIES.map(function (c) { return c.name + (c.home ? ' (home)' : ''); }).join(', ') + '. Drag it or use the arrow keys to turn it.');
    gwrap.appendChild(globe);
    var side = document.createElement('div'); side.className = 'pa-side';
    var flat = document.createElement('canvas'); flat.className = 'pa-flat'; flat.setAttribute('aria-hidden', 'true');
    var label = document.createElement('div'); label.className = 'pa-label'; label.setAttribute('aria-live', 'polite');
    side.appendChild(flat); side.appendChild(label);
    maps.appendChild(gwrap); maps.appendChild(side);

    var chips = document.createElement('div'); chips.className = 'pa-chips';
    var chipEls = {};
    COUNTRIES.forEach(function (c) {
      var a = document.createElement('a');
      a.className = 'pa-chip' + (c.home ? ' is-home' : '');
      a.href = focusHref(c.id);
      a.setAttribute('data-id', c.id);
      a.setAttribute('aria-label', c.name + (c.home ? ' (home) ' : ' ') + '— open in Passport Atlas');
      a.title = c.home ? 'Home: ' + c.city : c.city + ' · ' + fmtInt(c.km) + ' km from home';
      a.innerHTML = flagSvg(c.id) + '<span>' + c.name + '</span>';
      chips.appendChild(a); chipEls[c.id] = a;
    });

    var foot = document.createElement('div'); foot.className = 'pa-foot';
    var stats = document.createElement('span'); stats.className = 'pa-stats';
    stats.innerHTML = '<b>' + STATS.n + '</b> countries · <b>' + STATS.continents + '</b> continents · <b>~' + STATS.peoplePct + '%</b> of the world’s people · farthest <b>' + STATS.far.name + '</b>, ' + fmtInt(STATS.far.km) + ' km';
    var more = document.createElement('a'); more.className = 'pa-more'; more.href = link; more.textContent = 'Passport Atlas →';
    foot.appendChild(stats); foot.appendChild(more);

    root.appendChild(maps); root.appendChild(chips); root.appendChild(foot);

    // ---- theme ----
    function applyTheme() {
      theme = THEMES[resolveTheme(themeOpt)];
      root.style.setProperty('--pa-text', theme.text);
      root.style.setProperty('--pa-muted', theme.muted);
      root.style.setProperty('--pa-accent', theme.accent);
      root.style.setProperty('--pa-accent-soft', 'rgba(' + theme.accentRGB + ',0.14)');
      root.style.setProperty('--pa-line', 'rgba(' + theme.textRGB + ',0.18)');
      root.setAttribute('data-pa-theme', resolveTheme(themeOpt));
      flatDirty = true; kick();
    }

    // ---- geometry ----
    var geo = null, land3 = [], vis3 = {}, threads = {};
    function setGeo(g) {
      geo = g; land3 = g.land.map(toXYZ); vis3 = {};
      VISITED.forEach(function (id) { vis3[id] = (g.visited[id] || []).map(toXYZ); });
      flatPathsDirty = true; flatDirty = true; kick();
    }
    COUNTRIES.forEach(function (c) { if (!c.home) threads[c.id] = greatCircle(HOME, c, 48); });
    var threadOrder = COUNTRIES.filter(function (c) { return !c.home; }).sort(function (a, b) { return a.km - b.km; }).map(function (c) { return c.id; });

    // ---- layout ----
    var dpr = 1, W = 0, G = 0, FW = 0, FH = 0, stacked = false, flatPaths = null, flatPathsDirty = true, flatDirty = true;
    function layout(w) {
      if (!w) w = 640;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      stacked = w < 430;
      G = stacked ? clamp(Math.round(w * 0.78), 180, 280) : clamp(Math.round(w * 0.47), 160, 300);
      FW = stacked ? w : w - G - 14;
      FH = Math.round(FW / FLAT_ASPECT);
      W = w;
      maps.className = 'pa-maps' + (stacked ? ' pa-stack' : '');
      maps.style.minHeight = (stacked ? G + 10 + FH + 46 : G) + 'px';
      globe.style.width = G + 'px'; globe.style.height = G + 'px';
      globe.width = Math.round(G * dpr); globe.height = Math.round(G * dpr);
      flat.style.width = FW + 'px'; flat.style.height = FH + 'px';
      flat.width = Math.round(FW * dpr); flat.height = Math.round(FH * dpr);
      flatPathsDirty = true; flatDirty = true;
    }
    function fx(p) { return (p[0] + XMAX) / (2 * XMAX) * FW; }
    function fy(p) { return (YMAX - p[1]) / (2 * YMAX) * FH; }
    function flatRingPath(path, rings) {
      for (var r = 0; r < rings.length; r++) { var pts = rings[r]; for (var i = 0; i < pts.length; i++) { var p = project(pts[i][0], pts[i][1]); if (i) path.lineTo(fx(p), fy(p)); else path.moveTo(fx(p), fy(p)); } path.closePath(); }
      return path;
    }
    function flatPolyline(path, ll) { // splits at the antimeridian
      for (var i = 0; i < ll.length; i++) { var p = project(ll[i][0], ll[i][1]); if (i && Math.abs(ll[i][0] - ll[i - 1][0]) <= 180) path.lineTo(fx(p), fy(p)); else path.moveTo(fx(p), fy(p)); }
      return path;
    }
    function buildFlatPaths() {
      var outline = new Path2D(), n = 60, i, p;
      for (i = 0; i <= n; i++) { p = project(180, 90 - 180 * i / n); if (i) outline.lineTo(fx(p), fy(p)); else outline.moveTo(fx(p), fy(p)); }
      for (i = 0; i <= n; i++) { p = project(-180, -90 + 180 * i / n); outline.lineTo(fx(p), fy(p)); }
      outline.closePath();
      var grat = new Path2D(), lon, lat, pts;
      for (lon = -150; lon < 180; lon += 30) { pts = []; for (lat = -90; lat <= 90; lat += 5) pts.push([lon, lat]); flatPolyline(grat, pts); }
      for (lat = -60; lat <= 60; lat += 30) { pts = []; for (lon = -180; lon <= 180; lon += 5) pts.push([lon, lat]); flatPolyline(grat, pts); }
      var vis = {};
      VISITED.forEach(function (id) { vis[id] = flatRingPath(new Path2D(), geo ? geo.visited[id] || [] : []); });
      var th = {};
      threadOrder.forEach(function (id) { th[id] = threads[id].ll.map(function (q) { var pp = project(q[0], q[1]); return [fx(pp), fy(pp), q[0]]; }); });
      flatPaths = { outline: outline, grat: grat, land: flatRingPath(new Path2D(), geo ? geo.land : []), vis: vis, threads: th };
      flatPathsDirty = false;
    }

    // ---- state ----
    var view = { lam: HOME.vlon, phi: 24 };
    var AUTO_RATE = 0.0032; // degrees per ms (about one turn every two minutes)
    var hover = null, chipActive = null, overGlobe = false, dragging = false, pausedUntil = 0;
    var tween = null, vel = 0, inView = false, drawStart = null, pulse = null, raf = 0, last = 0, sunCache = null, sunAt = 0;
    var gctx = globe.getContext('2d'), fctx = flat.getContext('2d');
    var globePaths = {};

    function sunNow() { var t = Date.now(); if (!sunCache || t - sunAt > 60000) { sunCache = sunPosition(new Date(t)); sunCache.ring = nightRing(sunCache); sunCache.flat = nightFlat(sunCache); sunAt = t; flatDirty = true; } return sunCache; }
    function rotOf(v) { var l = v.lam * RAD, p = v.phi * RAD; return { sl: Math.sin(l), cl: Math.cos(l), sp: Math.sin(p), cp: Math.cos(p) }; }
    function threadProgress(id, now) {
      if (reduced || !drawStart) return reduced ? 1 : 0;
      var k = threadOrder.indexOf(id), t = (now - drawStart - k * 150) / 900;
      return t <= 0 ? 0 : t >= 1 ? 1 : easeOut(t);
    }
    function setLabel() {
      var c = hover ? BY_ID[hover] : chipActive ? BY_ID[chipActive] : null;
      if (!c) label.innerHTML = '<b>Home: Texas.</b> Drag the globe; hover a lit country. Shade is night.';
      else if (c.home) label.innerHTML = '<b>' + c.name + '</b> — home, ' + c.city + ' · ' + c.cont;
      else label.innerHTML = '<b>' + c.name + '</b> — ' + c.city + ' · ' + fmtInt(c.km) + ' km from home · ' + c.cont;
    }
    function setHover(id) {
      if (id === hover) return;
      hover = id; setLabel(); flatDirty = true;
      globe.className = 'pa-globe' + (dragging ? ' is-dragging' : '') + (id && !dragging ? ' is-pointer' : '');
      flat.className = 'pa-flat' + (id ? ' is-pointer' : '');
      kick();
    }

    // ---- drawing: globe ----
    function drawGlobe(now) {
      var ctx = gctx, cx = G / 2, cy = G / 2, R = G / 2 - 8, rot = rotOf(view), T = theme, i, id, path;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, G, G);
      // atmosphere
      var glow = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R + 8);
      glow.addColorStop(0, 'rgba(' + T.accentRGB + ',' + T.rim + ')'); glow.addColorStop(0.45, 'rgba(' + T.accentRGB + ',' + (T.rim * 0.35).toFixed(2) + ')'); glow.addColorStop(1, 'rgba(' + T.accentRGB + ',0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, TAU); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
      var sea = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.05);
      sea.addColorStop(0, T.seaHi); sea.addColorStop(1, T.seaLo);
      ctx.fillStyle = sea; ctx.fillRect(0, 0, G, G);
      // land
      path = new Path2D();
      for (i = 0; i < land3.length; i++) fillRing(path, land3[i], rot, cx, cy, R);
      ctx.fillStyle = T.land; ctx.fill(path);
      ctx.strokeStyle = T.coast; ctx.lineWidth = 0.7; ctx.lineJoin = 'round'; ctx.stroke(path);
      // graticule
      path = new Path2D();
      for (i = 0; i < GRAT.length; i++) strokeLine(path, GRAT[i], rot, cx, cy, R);
      ctx.strokeStyle = T.grat; ctx.lineWidth = 1; ctx.stroke(path);
      // visited
      globePaths = {};
      for (i = 0; i < COUNTRIES.length; i++) {
        id = COUNTRIES[i].id; path = new Path2D(); var any = false, rings = vis3[id] || [];
        for (var r = 0; r < rings.length; r++) if (fillRing(path, rings[r], rot, cx, cy, R)) any = true;
        if (!any) continue;
        globePaths[id] = path;
        var hot = id === hover || id === chipActive;
        ctx.fillStyle = hot ? T.hot : COUNTRIES[i].home ? T.home : T.accent; ctx.fill(path);
        ctx.strokeStyle = hot ? T.bg : T.edge; ctx.lineWidth = hot ? 1.4 : 0.8; ctx.lineJoin = 'round'; ctx.stroke(path);
      }
      // night
      var sun = sunNow(); path = new Path2D();
      if (fillRing(path, sun.ring, rot, cx, cy, R)) { ctx.fillStyle = T.night; ctx.fill(path); ctx.strokeStyle = T.term; ctx.lineWidth = 1; ctx.stroke(path); }
      // limb shading
      var shade = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
      shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, T.shade);
      ctx.fillStyle = shade; ctx.fillRect(0, 0, G, G);
      // threads
      ctx.setLineDash([4, 3]); ctx.lineWidth = 1.25; ctx.strokeStyle = T.accent; ctx.globalAlpha = 0.9;
      for (i = 0; i < threadOrder.length; i++) {
        id = threadOrder[i]; var pr = threadProgress(id, now); if (pr <= 0) continue;
        path = new Path2D(); strokeLine(path, threads[id].xyz, rot, cx, cy, R, Math.max(2, Math.round(pr * 48) + 1)); ctx.stroke(path);
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      // city dots and home pin
      for (i = 0; i < COUNTRIES.length; i++) {
        var c = COUNTRIES[i]; if (!c.home && threadProgress(c.id, now) < 1) continue;
        var q = viewPoint(c.lon, c.lat, rot, cx, cy, R); if (q.z <= 0.02) continue;
        var fade = clamp(q.z * 4, 0.2, 1);
        ctx.globalAlpha = fade; ctx.beginPath(); ctx.arc(q.x, q.y, c.home ? 3.4 : 2.1, 0, TAU);
        ctx.fillStyle = c.home ? T.bg : T.accent; ctx.fill();
        if (c.home) { ctx.strokeStyle = T.accent; ctx.lineWidth = 1.8; ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      // pulse on the focused country
      if (pulse) {
        var pc = BY_ID[pulse.id], pq = viewPoint(pc.lon, pc.lat, rot, cx, cy, R);
        if (pq.z > 0) {
          var ph = reduced ? 0.45 : ((now - pulse.t0) % 1100) / 1100;
          ctx.beginPath(); ctx.arc(pq.x, pq.y, 3 + 15 * ph, 0, TAU); ctx.strokeStyle = T.accent; ctx.globalAlpha = 0.8 * (1 - ph); ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
      // rim
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.strokeStyle = 'rgba(' + T.accentRGB + ',' + T.rim + ')'; ctx.lineWidth = 1.2; ctx.stroke();
    }

    // ---- drawing: flat map ----
    function drawFlat(now) {
      if (flatPathsDirty) buildFlatPaths();
      var ctx = fctx, T = theme, P = flatPaths, i, id;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, FW, FH);
      ctx.save(); ctx.clip(P.outline);
      ctx.fillStyle = T.flatSea; ctx.fill(P.outline);
      ctx.fillStyle = T.land; ctx.fill(P.land);
      ctx.strokeStyle = T.coast; ctx.lineWidth = 0.5; ctx.lineJoin = 'round'; ctx.stroke(P.land);
      ctx.strokeStyle = T.grat; ctx.lineWidth = 1; ctx.stroke(P.grat);
      for (i = 0; i < COUNTRIES.length; i++) {
        id = COUNTRIES[i].id; var hot = id === hover || id === chipActive;
        ctx.fillStyle = hot ? T.hot : COUNTRIES[i].home ? T.home : T.accent; ctx.fill(P.vis[id]);
        ctx.strokeStyle = hot ? T.bg : T.edge; ctx.lineWidth = hot ? 1.2 : 0.6; ctx.stroke(P.vis[id]);
      }
      var sun = sunNow(), np = new Path2D(), pts = sun.flat;
      for (i = 0; i < pts.length; i++) { var pp = project(pts[i][0], pts[i][1]); if (i) np.lineTo(fx(pp), fy(pp)); else np.moveTo(fx(pp), fy(pp)); }
      np.closePath(); ctx.fillStyle = T.night; ctx.fill(np);
      ctx.setLineDash([3, 2.5]); ctx.lineWidth = 1.1; ctx.strokeStyle = T.accent; ctx.globalAlpha = 0.9;
      for (i = 0; i < threadOrder.length; i++) {
        id = threadOrder[i]; var pr = threadProgress(id, now); if (pr <= 0) continue;
        var tp = P.threads[id], n = Math.max(2, Math.round(pr * 48) + 1), path = new Path2D();
        for (var k = 0; k < n && k < tp.length; k++) { if (k && Math.abs(tp[k][2] - tp[k - 1][2]) <= 180) path.lineTo(tp[k][0], tp[k][1]); else path.moveTo(tp[k][0], tp[k][1]); }
        ctx.stroke(path);
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      for (i = 0; i < COUNTRIES.length; i++) {
        var c = COUNTRIES[i]; if (!c.home && threadProgress(c.id, now) < 1) continue;
        var q = project(c.lon, c.lat), x = fx(q), y = fy(q);
        ctx.beginPath(); ctx.arc(x, y, c.home ? 3 : 2, 0, TAU); ctx.fillStyle = c.home ? T.bg : T.accent; ctx.fill();
        if (c.home) { ctx.strokeStyle = T.accent; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      ctx.restore();
      ctx.strokeStyle = T.coast; ctx.lineWidth = 0.8; ctx.stroke(P.outline);
      flatDirty = false;
    }

    // ---- animation loop ----
    function animating(now) {
      if (!alive) return false;
      if (tween || Math.abs(vel) > 0.002 || pulse) return true;
      if (drawStart && !reduced && now - drawStart < 150 * threadOrder.length + 1000) return true;
      return autoOn(now);
    }
    function autoOn(now) { return !reduced && inView && !dragging && !overGlobe && !chipActive && !tween && now >= pausedUntil; }
    function step(now) {
      var dt = last ? Math.min(50, now - last) : 16; last = now;
      if (tween) {
        var t = clamp((now - tween.t0) / tween.dur, 0, 1), e = ease(t);
        view.lam = tween.lam0 + tween.dlam * e; view.phi = tween.phi0 + tween.dphi * e;
        if (t >= 1) tween = null;
      } else if (Math.abs(vel) > 0.002 && !dragging) {
        view.lam += vel * dt; vel *= Math.pow(0.9, dt / 16);
        if (Math.abs(vel) <= 0.002) { vel = 0; pausedUntil = now + 1500; }
      } else if (autoOn(now)) {
        view.lam -= AUTO_RATE * dt;
        view.phi += (22 - view.phi) * Math.min(1, dt / 1600);
      }
      if (view.lam > 180 || view.lam < -180) view.lam = wrap180(view.lam);
      if (pulse && !chipActive && now - pulse.t0 > 1100) pulse = null;
      if (drawStart && !reduced && now - drawStart < 150 * threadOrder.length + 1000) flatDirty = true;
    }
    function frame(now) {
      raf = 0; if (!alive) return;
      step(now);
      drawGlobe(now);
      if (flatDirty) drawFlat(now);
      if (animating(now)) raf = requestAnimationFrame(frame);
    }
    function kick() { if (alive && !raf) raf = requestAnimationFrame(frame); }

    function flyTo(c, instant) {
      var dlam = wrap180(c.vlon - view.lam), dphi = clamp(c.vlat, -65, 65) - view.phi;
      vel = 0;
      if (instant || reduced) { view.lam = c.vlon; view.phi = clamp(c.vlat, -65, 65); tween = null; }
      else tween = { t0: performance.now(), dur: 850, lam0: view.lam, phi0: view.phi, dlam: dlam, dphi: dphi };
      kick();
    }
    function activateChip(id) {
      if (chipActive === id) return;
      if (chipActive && chipEls[chipActive]) chipEls[chipActive].classList.remove('is-on');
      chipActive = id;
      if (id) { chipEls[id].classList.add('is-on'); pulse = { id: id, t0: performance.now() }; flyTo(BY_ID[id]); }
      else { var tn = performance.now(); pausedUntil = tn + 1200; if (pulse) pulse.t0 = tn - ((tn - pulse.t0) % 1100); }
      setLabel(); flatDirty = true; kick();
    }

    // ---- input: globe ----
    function globePos(ev) { var r = globe.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    function hitGlobe(p) {
      var cx = G / 2, R = G / 2 - 8, dx = p.x - cx, dy = p.y - cx;
      if (dx * dx + dy * dy > R * R) return null;
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      for (var i = 0; i < COUNTRIES.length; i++) { var id = COUNTRIES[i].id; if (globePaths[id] && gctx.isPointInPath(globePaths[id], p.x, p.y)) return id; }
      return null;
    }
    var drag = null;
    function onGlobeDown(ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      var p = globePos(ev);
      drag = { x: p.x, y: p.y, lam: view.lam, phi: view.phi, moved: false, t: performance.now(), vx: 0 };
      dragging = true; tween = null; vel = 0;
      try { globe.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      globe.classList.add('is-dragging'); globe.classList.remove('is-pointer');
      kick();
    }
    function onGlobeMove(ev) {
      var p = globePos(ev);
      if (drag) {
        var k = 120 / G, dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        var now = performance.now(), prevLam = view.lam;
        view.lam = drag.lam + dx * k; view.phi = clamp(drag.phi + dy * k, -75, 75);
        var ddt = now - drag.t; if (ddt > 0) drag.vx = 0.7 * drag.vx + 0.3 * (view.lam - prevLam) / Math.max(ddt, 1); drag.t = now;
        kick(); return;
      }
      overGlobe = true;
      setHover(hitGlobe(p));
    }
    function onGlobeUp(ev) {
      if (!drag) return;
      var d = drag; drag = null; dragging = false;
      globe.classList.remove('is-dragging');
      try { globe.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      if (!d.moved) {
        var id = hitGlobe(globePos(ev));
        if (id) { window.location.href = focusHref(id); return; }
      } else if (!reduced && Math.abs(d.vx) > 0.02 && performance.now() - d.t < 80) vel = clamp(d.vx, -0.6, 0.6);
      pausedUntil = performance.now() + 2500;
      if (ev.pointerType !== 'mouse') overGlobe = false;
      kick();
    }
    function onGlobeLeave() { overGlobe = false; drag = drag && dragging ? drag : null; setHover(null); pausedUntil = Math.max(pausedUntil, performance.now() + 600); kick(); }
    function onGlobeKey(ev) {
      var k = ev.key, d = 15, c = null;
      if (k === 'ArrowLeft') view.lam -= d; else if (k === 'ArrowRight') view.lam += d;
      else if (k === 'ArrowUp') view.phi = clamp(view.phi + d, -75, 75); else if (k === 'ArrowDown') view.phi = clamp(view.phi - d, -75, 75);
      else if (k === 'Home') c = HOME; else return;
      ev.preventDefault(); tween = null; vel = 0; pausedUntil = performance.now() + 5000;
      if (c) flyTo(c); else kick();
    }
    globe.addEventListener('pointerdown', onGlobeDown);
    globe.addEventListener('pointermove', onGlobeMove);
    globe.addEventListener('pointerup', onGlobeUp);
    globe.addEventListener('pointercancel', onGlobeUp);
    globe.addEventListener('pointerleave', onGlobeLeave);
    globe.addEventListener('keydown', onGlobeKey);
    globe.addEventListener('focus', function () { pausedUntil = performance.now() + 4000; });

    // ---- input: flat map ----
    function hitFlat(ev) {
      if (!flatPaths) return null;
      var r = flat.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      for (var i = 0; i < COUNTRIES.length; i++) { var id = COUNTRIES[i].id; if (fctx.isPointInPath(flatPaths.vis[id], x, y)) return id; }
      return null;
    }
    function onFlatMove(ev) { var id = hitFlat(ev); setHover(id); if (id && id !== flatFly) { flatFly = id; flyTo(BY_ID[id]); pausedUntil = performance.now() + 2500; } }
    var flatFly = null;
    function onFlatLeave() { flatFly = null; setHover(null); pausedUntil = Math.max(pausedUntil, performance.now() + 1500); kick(); }
    function onFlatClick(ev) { var id = hitFlat(ev); if (id) window.location.href = focusHref(id); }
    flat.addEventListener('pointermove', onFlatMove);
    flat.addEventListener('pointerleave', onFlatLeave);
    flat.addEventListener('click', onFlatClick);

    // ---- input: chips ----
    function chipEnter(ev) { activateChip(ev.currentTarget.getAttribute('data-id')); }
    function chipLeave(ev) { if (document.activeElement !== ev.currentTarget) activateChip(null); }
    function chipBlur(ev) { if (!ev.currentTarget.matches(':hover')) activateChip(null); }
    COUNTRIES.forEach(function (c) {
      var a = chipEls[c.id];
      a.addEventListener('mouseenter', chipEnter); a.addEventListener('mouseleave', chipLeave);
      a.addEventListener('focus', chipEnter); a.addEventListener('blur', chipBlur);
    });

    // ---- observers ----
    var ro = null, io = null, mo = null, mq = null, rmq = null;
    function onResize() {
      var w = Math.round(el.clientWidth || root.clientWidth || 0);
      if (!w || w === W) return;
      layout(w); drawGlobe(performance.now()); drawFlat(performance.now()); kick();
    }
    if (window.ResizeObserver) { ro = new ResizeObserver(onResize); ro.observe(el); }
    else window.addEventListener('resize', onResize);
    function startDraw() { if (!drawStart) { drawStart = performance.now(); flatDirty = true; kick(); } }
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) { inView = entries[i].isIntersecting; if (inView && entries[i].intersectionRatio >= 0.2) startDraw(); }
        if (inView) kick();
      }, { threshold: [0, 0.2] });
      io.observe(root);
    } else { inView = true; startDraw(); }
    if (themeOpt === 'auto' && window.MutationObserver) {
      mo = new MutationObserver(applyTheme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      try { mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', applyTheme); } catch (e) { /* ignore */ }
    }
    try { rmq = window.matchMedia('(prefers-reduced-motion: reduce)'); if (rmq.addEventListener) rmq.addEventListener('change', onReduced); } catch (e) { /* ignore */ }
    function onReduced() { reduced = !!(rmq && rmq.matches); flatDirty = true; kick(); }
    function onVisibility() { if (!document.hidden) { last = 0; kick(); } }
    document.addEventListener('visibilitychange', onVisibility);

    // ---- go ----
    var decoded = DATA ? { land: DATA.land.map(decodeRing), visited: {} } : { land: [], visited: {} };
    if (DATA) for (var id in DATA.visited) decoded.visited[id] = DATA.visited[id].map(decodeRing);
    setGeo(decoded);
    applyTheme();
    setLabel();
    layout(Math.round(el.clientWidth || 0));
    el.appendChild(root);
    var w0 = Math.round(el.clientWidth || 0); if (w0 && w0 !== W) layout(w0);
    drawGlobe(performance.now()); drawFlat(performance.now());
    try { var r0 = root.getBoundingClientRect(); if (r0.width > 0 && r0.bottom > 0 && r0.top < (window.innerHeight || 0)) { inView = true; requestAnimationFrame(function () { if (alive && inView) startDraw(); }); } } catch (e) { /* ignore */ }
    kick();
    if (opts.dataUrl && window.fetch) {
      fetch(opts.dataUrl).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (topo) { if (alive) setGeo(fromTopo(topo)); })
        .catch(function () { /* keep the embedded coastline */ });
    }

    function destroy() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize);
      if (io) io.disconnect();
      if (mo) mo.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener('change', applyTheme);
      if (rmq && rmq.removeEventListener) rmq.removeEventListener('change', onReduced);
      document.removeEventListener('visibilitychange', onVisibility);
      root.remove();
    }
    return { el: root, setTheme: function (t) { themeOpt = t || 'auto'; applyTheme(); }, destroy: destroy };
  }

  window.PassportAtlas = { mount: mount, visited: VISITED.slice(), countries: COUNTRIES.map(function (c) { return { id: c.id, name: c.name }; }), caption: CAPTION };
})();
