/* Passport Atlas widget — a compact "countries I've been to" map for any page.
 *
 *   <div id="atlas"></div>
 *   <script src="/misc/34-passport-atlas/widget.js"></script>
 *   <script>PassportAtlas.mount(document.getElementById('atlas'), { theme: 'auto' });</script>
 *
 * Options: theme 'auto' (reads <html data-theme="light|dark">, then prefers-color-scheme),
 * 'light' or 'dark'; link (href of the full page, default the atlas folder next to this
 * script); dataUrl (optional path to countries-110m.json for a higher-detail map; the
 * widget falls back to the coastline embedded below). No dependencies.
 *
 * Coastline: Natural Earth 1:110m via world-atlas (ISC), simplified by build-widget-data.js.
 */
(function () {
  'use strict';

  // ---- the owner's list (ISO 3166-1 numeric ids, as in world-atlas) ----
  var VISITED = ['840', '124', '484', '704', '276', '380', '056', '392'];
  var HOME = '840';
  var CAPTION = '8 countries · 3 continents';

  // compact coastline: polyline-encoded rings (0.1 degree), land outlines + visited countries
  var DATA = /* DATA_BEGIN */ {"land":["inB|IECED@JL@HA@IGE","noB`ICA@H@@","coBnILB@GICE?KE","ooBsg@XHXAQHKNIDAFDDb@Cv@LP@^NZJFFZMr@NHGPHZCDLVRAFUB@ZR@FNGF`@JFT\\BDTZPFMF]Jk@I[QK?G_@Ea@Wc@Sc@OO]V@JPr@TNYr@Fp@^OLj@B\\@?M\\CXHz@A`AD~@d@lAn@_@@IJSBKIU@[TAPNR@VF^\\ZFLt@l@JJZJJ?JIZL@FFAFFDD?LHBJHJBHB?H@@G@KHOVEJ?VFHPBNFP@@ICOHSOCLOHC@@D@@CHCEGCC@AEK@CJAFCZDNFRDIIBGOKJINDVLJJR@HHKJOB?HOBUMQFM?AJZBHJPHHLSHGRKPMN?NJBCJKDBNBNJ@LRNZPVZPZNT@JHFEJFZHRBFTH?DMEGZEH@XPNPBLa@n@QJKNGd@@`@NLVJNPVPFKEMNKNAFKHSPGP?COP?@TNl@?NM?GPCPIHKBIHE@KJGJ?L@HADAJGDEP?DL@POVO@IJK@QFIAMBIFEBIRUBJBICMEQ@OEMFKAUFIDWBYFOLHTLJAJCEYBQNWCEJCLODI@IBIFKP?AFDJHC@@LC@FL?VB?NHHZLVVLJRL?FHDPDH@DNCXANFP?`@J@FNEDPDFJFDPQH[FSDIHQDYBKP[Fe@DY?WBSZJLAXWGGDETQNCDOLMd@B^?Z@d@ETCTAFYHAN@RHVEROREJQNYH@LEDFJACH@BM^IBCFMF?F@FADEDEH@MEIEAED?JBJCFCA?DOC[@MMMKMMEEA@@F@BANGLKDMBK@MPGB?BHPFDFLHABD@HAJ@BH?JD@HBBJ?FD?FHDJAJDH?LDBH?DRF^HPLH@DAHFLBN@D?BDD?@DH?D@L?DKAKBEBMDGCA@GAC?GBIDE?GHEJQDOLMFALS@MAKJUHGHCDK?CDIDCDOV]H?CI?GCG@ADFBNBHDBNOL]@@GTKRO^GHEJQTB@?LWPCBERBBARGVQJKVEPIH[P[\\IDCD?FJDOFCFGHI?SESAQEIAGCQ?GCKAGEG??D@H?JBDBTHTJXP\\PTTXRP\\PRNTVBHBDLFDFD@BLDFBJFFHVAJKDADDJAD@HEJIREBCH@RCN?^CHDLFLJJh@PTTF@LNFB@LINCH?DC?@R@FCB@FHFNDVJFDAFC@@HBN@NDHPJFHDHHLVTLJLFTFH@@BJAHBTCJ@F?TFN@JFH?FEDAHG?@BCAKFMEC?MJSHONYLOFMBSDMD]?W@KFGHOJWBMNQ@O@KCQEQAIEQCGKKEIAM?KDEHW?CEGHa@HKACFUNSRSLQJS?ECEEOCMBCEUCOFKHCBIBA?ERFFAFDNAHKFMLM^?NBNB^JJDPDPEF?LCJ?VBLDRFHARGPOPIJMDALGHIBG@MHKFGHE@I@CDAJIF?BE?CDCBSAGFOHEGCIMCI@KEICQBS@IAIBIJGAQGEEI?EEMKMEAEK?IGMKEMSIGQAOMIEOOBYGOAKKKSIOGMSEMM?KHSASBG?SIUCKGSEa@C_@AIBSGS?GBM?UIMB?HOGABHH?HEB@PJHAHK?CHGBWDGAOBYFIPQB[FUHICIIDOEGOIKA[BEFG?EBS@EDY?SD[FOEGEQAMBEHCGODO?ICEE@AEICMAEGOIM@OCGDIGGJ@PCLJ\\@NITABFLBRKT?JSLIIOJIUQ]AGMe@@WKWEa@?a@L[FWCQ@WIAIBKJGJADEXQVGNIMCOOHG[G?EPBN@JDR@ND?JIDSABFTBXHJCCGREACSGDC^C?GR@DJNL?DHBDABVJFDLEJAFQDBBV@FDNHFGACLAH?VBMJH@J?HIBBEJIHFBIHID?HPCEHJ@GPL?NGFOBMPS?EBA?CJG@GAMAEDEDEHCPEJGPENMCAHG?GJADFDE?GCANANDAH@DEHQHINUNO?EDDB_@JQHABBFJINAFJMF@HH@HNF@?ECKCCLSFCDGJCHGLANGPMLIDSHANGHBJFF@PJd@E\\D@J?JPLXB@DJJFNGJJFBLLBLLX?R?JFFFHADGDIRCFDHCH@CO@KHABEAMGG?GCK?GBE?G?MFG[MW@[?UBOA_@@IKCg@RUNI\\G@MYCa@DDWQHm@OEOa@GIEQ][GO?CCO?CBMIBG@KFI?SCECEQAGCOE@HBDADI@BFDANLEH?FSB?FUCIEUFIDME_@GWGSBADS?CI[EBO?OIKQGONO?COAKD@LE@KYEYASBUAUIRIb@@b@D^DJKRECSFQGKQKm@UMC@GZI`@DRLCJ^Nf@PLZMLSHPTTDF`@HPVAJNV?DQNUN]JKf@VZBXIFUDm@QKu@Qe@Se@[o@e@_@Ow@Wk@I_@@]Oe@?c@C}@LXDUJSEa@Ju@BkAVOF?LTH^DxAOLB_@LAH?RYDOBAGJIMEo@JOEJMm@SQ@SDIMNKIKLKw@FIHV@?JMD_@CCKi@IeAQO@RJW@MEe@A]GUJWKTKKGy@F[DgATMIRI@EVAGGJO?Ec@QMQMCu@BCJRNMDELBZUJHLd@ZU@GEUEEIQIJIGMTABIOSXOc@MBMIAIJFRU@HMa@Gi@?c@JPQ@Sa@Eq@@i@ANKWKU?g@Is@CECu@AOBk@Ie@?CISGo@Ga@DZDm@@CHSCy@?k@HOFBHTDr@HNDWB]BQCILIE_@C_ABCHsA@AMi@@_@?_@JIJJFWN_@FSS_@Fa@Ee@FMEa@@NQ[GsDJQJs@NoACg@@OF@NWD[Cc@Ac@Be@Ac@PWENMIG}@Di@Ay@H","noBcj@q@Ns@R@JMDDOu@Bg@PRH^@@PFBP?NEXEBIRAV@HECGVBIHJF","|uAmj@_@HS@QGWE]@]G_@EMFMCEIM@_@P[MANWCGEW@_@Fm@F[BSAYHZHc@Bu@AQCSJUIRGKGW?QAOBSJUAa@H_@C]?BKQC_@F?PKOO?ISTKVGAUWMY@SH[TPHe@B?RYOWLDLSLSMMQAU[@]@YHAHNJMH@Hd@LZ@TEDHPPDFVLZ@NF@JTBXNRTFN@V]@GRIL[Ce@FSFMHWDUF_@@U@@NERMT]ROEIUH]LK_@GUMKM@MLQVMWUHQD]MEa@DS@QCQDWJEFc@??PEVQBMJ]KSUKGOPYVUVFLYHQJ_@DMDGNMBGDAVZL`@DVP`@@j@C\\?R@NLXF\\ZTPOC_@Yi@O]AQHPJETENYHa@CSU?LMFVJl@JPFVNLA@Qc@O^?TBADRHTDRDLN?JEHG?@EEB@DJ@H?NBR@ND]CEBZDL??CDDE@BLLN@EB?DECHCB?FDFHN@AEKHGBO@FCJLAMD?PE@ADCRLNRDLJH?HF@DTLJHFJBLCLENIL?HGT?TDJD@HA@GFER_@BGCMBINOFCRHBAHIJCT@PAN@F@CD?FCBB@FAFBL?LKP@LCJ@PBPNRFHHDF?LAHCDFPBL@Z@HCHEHCNMLCJGHUBGHQEMA[GKGEK?OCEMEUCO?K?EB?HJHBLC@FVDCB??@C@?BBHA@@FA@BHBB@@BDEBACGBCCE?M@I?GCK@GAKBKFG@EDBDAFBD@F@HAL@@@F?DBBADABEHGFON?BG?A?EBIAGCKCEEK?@@K@GBMHK@MMGA?GCOKIK?ACO@WOGGG?EDBD@DH@EF?JHHGNG?EOFE?OWG@GGGELM@MH?DQ@UAIFO@KE?CWAW?NDEHO?OHANI?UJKL?HG?SNWBACO?SBUFUNAFG?CJK`@IBALNNEDc@@?ROKWDa@LIHBJWEe@H]?]NYTMDQ?GFIb@F`@HJZZLVLND@DLAd@Fj@DFBXRX@RPHBJT?\\FNFTDTNPR@LAJBRBHLHTb@PNLFFRLJFJTJNCH@PIL@JK@HYPBLMF@HPX\\Hf@BTACJBNCHJDTBPGFDARMDIGEJPDNJ@RDHP?NJDLSLSBFPVJJVPFFFETKJFAP?FBPFBPF@VGTMVIFMEKHK@a@GSUO\\EQOEa@WFIi@LEDXJCE[Ee@IKDS@UGAK_@M_@I]D]EO@WKYCe@Ei@Ek@@_@B]RI@Gd@Sb@UNMFOAENYRc@Pg@FIFMLMNGGGHSEMOKIMBIFHJICC@QECCKGM@GKCKG@EGA@IEEIAOUFECKBQCCBQFIDEBKCCBABEHEH@BDFDB?@BIJFBH@BK@BDABGFADAF??BBAHCBEAA?EDCLE@EDCADBBBCFA@C?EAGBACCNMBEHGHGACE@BEDA@DJADAHCH?DCHCJ?HCHGVUHENEJ@NDH@LCLCPINATIPGBEJAREFGTKHKBIEA@ECE?EDI@GDIPSRMHMPG@CAKHEJIBMJ?JKFI@EHMFOAGNGD@JE@FAHALGFSRCFA?CJEDEDKHERKP?HI?OP?BHF@?DKJKNIHC?O@IVO@BBELCJKAAG@GG?ILMJEVg@FQBIJKHA@EJADCRABC@KRSN[?CHELQBOHICO?QDOGQCc@B[DODIAC]FIPEEBODOB?d@SLGb@GJQCKXIBOVM?IJGPEBQXOJQPA^?VEh@St@KZ@d@IVGTBCLJ@TBPDTBBIISUEDEXJLJZLMHPNTFRDDF\\HDHVFL?PBRFPD`@D@CUGQEUKWAIG[KCCOGAMKKVDDCJFJIDDFIRFJ?@KCEJGXBPIJC@KLGGKOIEIOAM@OGO?MEBGHCMGJ?TBDDLE\\BZEFGXK[Gk@IO?@Hi@?NKVGLIRGZGKIc@?WIEISGSAe@IQ@]K]DOFGCa@@@B_@BSAi@De@@O@YC]D","ns@af@OGY??BVHL?","zp@ol@TIAGGAm@@c@J?Dh@ATB","|p@_f@G?CBFJFADE","ny@{m@JFZAVCII[CQD","ry@mo@H?d@ABCg@?MB","n{@gp@WFBD\\DNEHG?GY@","`v@om@`@Ar@EFK@IRGh@ATGGGg@@UDg@?QDDFWDKB[?[@_@Cg@Aa@@SFEFLBZDXCx@B","pdA{o@[BDDd@DZEOG","jdAgp@YBVB^??CSE","`b@u^LPMEKBDDQDGESFDLMCAHGLHNF@LCCOBCVPJ?MIRCR?f@?@EKGFCOKS_@MKOEI?","ls@ug@UDWD?HOAMFPD\\EJGRHZHFIX@OICOEQM?CHIC","fp@gl@SGk@J[FAHe@ESLo@FQFQPb@Hm@J_@D]P]?DL`@VVG^SX@@JSJ[HGBKRDLXCp@O[NUJAFt@Gh@KVIEE\\IZI?Dx@BPGMMe@?g@CDEGIWSBGFG\\Ih@EMCTMP?NGHDb@BfAEj@E^ANGSGZ?DSOQSGs@ENJOLQOs@Ia@TBJ","`z@im@i@?e@B\\PVBTNTAJO?III","xkAqn@a@Oi@K]?[A@LNFP?d@F^B","|qAw`@SAFTQNF?JGFIHE@I?E","|`Aqp@g@@u@FMHGF^A^El@ASEVC","dlAi]H@`@GDGNEBETCDI?Ea@FQ@QNSF","|jAom@[Bq@?SDUFXDn@LXL?Fr@HHGl@KUUQMRK","jbAkn@QCS?CHJHbA@p@H\\?BEi@IxABZC[SQEw@Fc@Ja@?ZQQGS@GH","paAul@UFKRELa@Hc@H@F^@KFDDb@Ab@ET@d@Dp@Bb@@JIXEP@VOKA_@A[?YCd@Cj@@Z?HGm@G^?`@EOMMGu@KSBHFm@EYHWIQFOPIGLSQA","v}@ml@TMUGWBc@CEDRH_@FBP`@FPALEp@O?E","raA_m@Y?OBPJ\\M","p|@}n@OF?JHL^@TC?I^?@MU?]E[?","~z@kq@MESAFCm@AYJa@B_@BOJWFZDb@Lb@@h@ATIAEOEd@?TEJI","fx@er@]CW?e@C]GW@UDOKYAc@A{@AK@y@AkCBi@@c@D?Bn@Hp@BPBk@?l@J`@D`@Nf@BLBz@@[@LBOHPD^DHFZDCBa@??Bt@Jr@Ex@B\\Ad@A@Ic@CHMMAs@HXM`@COGc@CEEZGFKu@@O@_@Gl@AdA@b@GNGVE","~m@ci@LDT?BIGIQCOD?F","vz@ej@LDXEN@ZGQEMG_@F","hg@e^EAYDUF?BH?XE","~f@k\\EHO@Q?HFF?VGDE","~_BoKGH??LFBBBC?CBGCE?CA?","n`B_L@BD?DEAAE@","vaBqLEF??F?BE","rbB{LABB@DCCA","`gBwd@O@AFJ@JALE","v~Agc@K@IDPHRFHEBIQE","hjB{f@KBKAODS@@@LBNCFCP@BA","cwAr@a@Le@JMHIHCJ_@JEHP@CLQJKTK??FMBDBUF@DL@BEd@ENKHKJOXINDJDANNDHATAPORCBDX?GOMEDUHOd@QN?\\SDHF@BG?GNIUEM?@E\\?FKPCFI[CIE_@FAFE^UJOUUKQ?QFMD","k~AhAGDAHDDBKBGROLECCKDMF","q}ArBTHH?NEJEAEQBIACIA?AHK?EGIE@KKACB?JDJH@","w_BhBEDGJID@DD@FGHKBOCA","emAzDLLND@CAEGKSGACOEM?GAE@DDTF","{rAhC@OGMCD?H","egAkBMMIOG?IHAFKDQD@FL?CHLFJPMP@HUPV@DL?PPL@RF\\@ETFFKLAHEVFFIL?NA@YHEHO@QAQKMMDOCCOGCWCMOIKGG","{oAv@UDENNIN?J?L?CK","inAjALCBGSACF","}nAk@AJK@AF@NHA@LGHD@FKDYCO","ykAQW?SMABNRLBRC^?PBBLQPKGc@G?HHCFJPFSXBDQV?JJDFEIORFBEAGLKASLDAV?ZJBFEEQBSF?DMGMAMI_@CGQMOD","ejAlEXMQCIDGD@B","yjAhDM?QG@J\\BZA?GOC","}hAfDKACFb@DJ?GIIAEE","ybA~BAFe@@EGc@FGL]BWJTFTIP@TAPCVGLAFBb@GBIP?MSW@OD","g`ATALGHM@ILBV@^T?NQXOFKNOHMN[NQDOFOPMHONKRU@IK@_@BQPMLKFQTU?OLKNMHFNKF","zi@z_@EHILYL[BFHR?HEDFNDTANERAXKRIZWQB[LYFIIEMSG","xk@gJLCF@LAFBJEAGSBM@GEHG?GJACEK?QBACO?KDC?CDK?@DI?IFFFHCF?F?@BF?BCD@FLDC","sy@sq@i@Eg@Jm@PDPh@@v@C`@GNMXC","g_Aqp@s@JDFpBFe@YOA","wuAqn@u@?gAHNNhA?^Bf@MIK","s{Aan@q@BTF^Ad@GEE","mvA{l@QGYA[FAD\\?h@A","_[kq@g@C]?CDKEQA]BFBj@B@@VBTCKG","m`@cm@o@ODIm@IaAMaAAa@Gg@AMFLDfAHz@F|@R\\R^PCPe@NJ@~@CDGb@E@ISC@Kg@O","ixAq`@GR@PGTU`@\\EJZQT?LNKJLBOAS@UCMA[JQA[QIFGIC","noBuk@AAQ?[D@BRBX@","jp@wOIAM@?BTB","ro@{OOFBLBAAIHG","zo@wNE?GP?HD@BKFE","fe@j_@WIOBMGOFDFZDFGPH","mHyp@GE]AYF_ALp@FHNPBHNV?h@KQE\\Ef@QNOw@EID","cPaq@\\Jx@@x@CBCZATG}@E[BSEq@D","mNuo@j@Hb@EMCJGi@CGF","f\\sr@cAKeA?YEeAA_D@}BNd@FjA?jB@IBeAA}@De@EOFTHs@E_BG{@BKFpALHD~@@m@@VLNJ?VWJ\\@`@De@HCPT?YPj@@WFFDZBZ?YL?Ff@GHD[BYJEN`@BNGVIEJVJu@?[@t@Nt@Nz@FT?RFZRj@LJ@ZBZBPL?LHJ^NGNRb@Z@\\Qf@?PILS`@WHMBQZQGMLGSW]EGGCO`@HP@VE@MGIS?g@Br@QR@NEUQJGf@a@XG?Gt@Kh@At@@n@?VE`@Ks@Eg@ArACl@GAGkAIiAIGGt@EQGcAM]AFIm@C}@C}@?UDs@Io@D[@i@Dn@I","aj@j]MDQBABDF^@?K","mDsYMGCNFNFCDM","lh@qJI@CBBBN?J@?IAA","`o@oJIBCDL?DBJCHEAEG?","lr@oMQ@O?QDGFSAEB]TE?KB@DO?MF@BLBJ?LA\\@MIFEJ?FEBKJ?PCDCXCFCGCRALHF?BDF@HAKECGGCICOA","}]xFEFELAVEF@HBDDKBDCN@FDB@PFTHZJd@FZFTNDPFZKBI@QFO?MAOIA?GIMAMDGBM?QEIAMI?KCGCG?KKOKEI@GG@IMAKEI","ogB|HKJD@DG","ggBxH@E@OIDCNDA","mOaU@D\\@?CVCCGIDO?O?@B","zBu`@CLNPb@JZAOUHS[OMGQASJ","sfBdLOJIHFBHELGLKJMBEI?IF","idBpEEDL?FKKB","adB~DBBLQBKE?GN","qcBdEF?JADCAGMBEB","wbB~CED?BNGHEFGCA","eaBjCGDB@FCFG?C","_mBxXNF@EFAIODKTGAGMEAO?KFM?CHGLQHMG?KHMDEPMRAMGDCNODK@KGI@BPDJNADDAH","aiBfZOKKIIMGEAIMIGNOGCF?HDFLNHFGHN?NDDLJRXLP?JETABEIOYSKC","i{AnXK@AVFD@NDELLB?LAJO@MJO?IM@SD","ymAbSRHPDBHDFP?J@PCL@L@JHD?HBHFLAL?RKJC?KIACC?GAM@KHSBK?IFM?EFGBOHOBGIFFQIDEF?IHO@EBEAKCCAI@KGMALGMQEGGOGIAC@OEKACEE?I?UEIIEIIIAQMQGPICFIEIIBAMIIEGIC?EG@?CSEMHKJK?K@BKIOGC@EGKKEI@QC?INEKCKDKFOBEAKDKCG?CAIHDHFFD?AFDHFHADOJODIDMJE?IDCDQDMEGSAKEO@G?E@KCOAC@ECICK?EGEEHAJC@AFEHAJ?FELMEEFIF@FEZE@EP@HELUHYP@BKLGRGCGHCCCTWRONCNAH@LIN@PBHBP?HBLHRLFFNDHDPFHBLBLADJFT?PFHFJFNGJCAIHBPLZGJAREJKBOBIHGRAEIBMHLPBKKAKGI@MNPJDFNNG?KJMHGCCXKL?RIb@@n@L","cr@uCBRFDPBFOB[G_@MHIL","mcAkJNE@QIGUEK?CFFFDJ","ckAgNJ^HNHO@OKQOOID","uH{VDNADBHNGHAZICIU@","mDqXIEKL@XH?FDFE?WBK","wFab@EHJNTK@G","|@k`@CKLKVCDEGGDEJH?SJIGSOOO?W?TRSAU?BNPPS@SXM@KVEFWB@JJDGHPHX?`@DHCJHPALDJC]SQC^CDGUEJICM","`Hqh@BLULXLx@LPBpAISGj@Ic@C?Eh@CKM_@A]L]KYD_@I","ojA}FHOQ@EDBP","wkAmEAKK?BJOQ@PFFDJDDJM","anA{C?JDPFSFHENDFVKDMEIJGDFHALJBEGOKEKGEHOECIM?@OOH","aiAyDXPIMMKKMISCNLJ","mkAkJ@FELBNJFBNCNK@GAYH@JEB@HNIFKBFLKPBHEAGECDE@FHKBG?SGFA_@EQK?KDEE","gkAcF@IKDK??FHHJD?I","mmAsFEVNE?DEJHD?MDABKK@?GJOQ@","uwAoWPR?TFNCHHLXFb@@ZTLE?Ob@BTHV?SNL^JHHGCQJEFMSEIKSKMKg@EUBSc@MHg@[MWBWGKUCIZ","kyAoZMGCTZDPR^MHTT?BSIMUAE[EOUTOD","wqA}SIKKBGIMDCDJJFEHBDJJE","oS}TAEO?QELHABRFHABG","pe@wEKAC??NP@BAEE"],"visited":{"124":["vkAs]B?d@SLGb@GJQCKXIBOVM?III?K`@M`@c@PIJGJIRDRJNMLGRER??qB?iAe@B_@HS@QGWE]@]G_@EMFMCEIM@_@P[MANWCGEW@_@Fm@F[BSAYHZHc@Bu@AQCSJUIRGKGW?QAOBSJUAa@H_@C]?BKQC_@F?PKOO?ISTKVGAUWMY@SH[TPHe@B?RYOWLDLSLSMMQAU[@]@YHAHNJMH@Hd@LZ@TEDHPPDFVLZ@NF@JTBXNRTFN@V]@GRIL[Ce@FSFMHWDUF_@@U@@NERMT]ROEIUH]LK_@GUMKM@MLQVMWUHQD]MEa@DS@QCQDWJEFc@??PEVQBMJ]KSUKGOPYVUVFLYHQJ_@DMDGNMBGDAVZL`@DVP`@@j@C\\?R@NLXF\\ZTPOC_@Yi@O]AQHPJETENYHa@CSU?LMFVJl@JPFVNLA@Qc@O^?TBLK?[FELBDCNLDNFFFBD?@DbA?FBVNDFd@?H@CBAFXHTBTHD?DA@ECEIKEKHa@RIAC@AD?BC?CB@D?AADA@E^Md@MPDD?VENBRGRALADABKF??F","ns@af@OGY??BVHL?","zp@ol@TIAGGAm@@c@J?Dh@ATB","|p@_f@G?CBFJFADE","ny@{m@JFZAVCII[CQD","ry@mo@H?d@ABCg@?MB","n{@gp@WFBD\\DNEHG?GY@","`v@om@`@Ar@EFK@IRGh@ATGGGg@@UDg@?QDDFWDKB[?[@_@Cg@Aa@@SFEFLBZDXCx@B","pdA{o@[BDDd@DZEOG","jdAgp@YBVB^??CSE","`b@u^LPMEKBDDQDGESFDLMCAHGLHNF@LCCOBCVPJ?MIRCR?f@?@EKGFCOKS_@MKOEI?","ls@ug@UDWD?HOAMFPD\\EJGRHZHFIX@OICOEQM?CHIC","fp@gl@SGk@J[FAHe@ESLo@FQFQPb@Hm@J_@D]P]?DL`@VVG^SX@@JSJ[HGBKRDLXCp@O[NUJAFt@Gh@KVIEE\\IZI?Dx@BPGMMe@?g@CDEGIWSBGFG\\Ih@EMCTMP?NGHDb@BfAEj@E^ANGSGZ?DSOQSGs@ENJOLQOs@Ia@TBJ","`z@im@i@?e@B\\PVBTNTAJO?III","xkAqn@a@Oi@K]?[A@LNFP?d@F^B","|qAw`@SAFTQNF?JGFIHE@I?E","|`Aqp@g@@u@FMHGF^A^El@ASEVC","dlAi]H@`@GDGNEBETCDI?Ea@FQ@QNSF","|jAom@[Bq@?SDUFXDn@LXL?Fr@HHGl@KUUQMRK","jbAkn@QCS?CHJHbA@p@H\\?BEi@IxABZC[SQEw@Fc@Ja@?ZQQGS@GH","paAul@UFKRELa@Hc@H@F^@KFDDb@Ab@ET@d@Dp@Bb@@JIXEP@VOKA_@A[?YCd@Cj@@Z?HGm@G^?`@EOMMGu@KSBHFm@EYHWIQFOPIGLSQA","v}@ml@TMUGWBc@CEDRH_@FBP`@FPALEp@O?E","raA_m@Y?OBPJ\\M","p|@}n@OF?JHL^@TC?I^?@MU?]E[?","~z@kq@MESAFCm@AYJa@B_@BOJWFZDb@Lb@@h@ATIAEOEd@?TEJI","fx@er@]CW?e@C]GW@UDOKYAc@A{@AK@y@AkCBi@@c@D?Bn@Hp@BPBk@?l@J`@D`@Nf@BLBz@@[@LBOHPD^DHFZDCBa@??Bt@Jr@Ex@B\\Ad@A@Ic@CHMMAs@HXM`@COGc@CEEZGFKu@@O@_@Gl@AdA@b@GNGVE","~m@ci@LDT?BIGIQCOD?F","vz@ej@LDXEN@ZGQEMG_@F","hg@e^EAYDUF?BH?XE","~f@k\\EHO@Q?HFF?VGDE"],"276":["yGs`@EJDBEFEH@FGJF@DABBNBDBNBCDAHIBKFFHD@AL@@DCH?LBPA@DHED@TEBBN?AMIMZCHE?GBCCMBUK?CEEQBGCCO?CBMIBG@KOBKC?FSB?FUCIEUF"],"380":["oEi\\M@AASCCD[D@HCFNANDAH@DEHQHINUNO?EDDB_@JQHABBFJINAFJMF@HH@HNF@?ECKCCLSFCDGJCHGLANGPMLIDSHANGHBJFF@CGJCDMGEDG?EIBI?IGCBI?CGM@IC","uH{VDNADBHNGHAZICIU@","mDqXIEKL@XH?FDFE?WBK"],"392":["uwAoWPR?TFNCHHLXFb@@ZTLE?Ob@BTHV?SNL^JHHGCQJEFMSEIKSKMKg@EUBSc@MHg@[MWBWGKUCIZ","kyAoZMGCTZDPR^MHTT?BSIMUAE[EOUTOD","wqA}SIKKBGIMDCDJJFEHBDJJE"],"484":["dhAiSUAYA@B]Hm@Lw@??Ia@?GFIDKHEHCHKDODKOO?MFILGJKJCLEFODMDGAFPBL@Z@HCHEHCNMLCJGHUBGHQEMA[GKGEK?OCEMEUCO?K?EB?HJHBLC@FVDCF?DJBA@Bd@??HH?GFGBABC@@DV?HNAB@D?DVUHENEJ@NDH@LCLCPINATIPGBEJAREFGTKHKBIEA@ECE?EDI@GDIPSRMHMPG@CAKHEJIBMJ?JKFI@EHMFOAGNGD@JE@FAHALGFSRCFA?CJEDEDKHERKP?HI?OP?BHF@?DKJKNIHC?O@IVO@BBELCJKAAG@GG?ILMJEVg@"],"704":["e`AqEQGSAFKa@MAWBMCSDMLM\\i@VKEEKEFQV?FQJOICO?SAOKIFQB@JGFSBXPNPBLa@n@QJKNGd@@`@NLVJNPVPFKEM"],"840":["vkAs]gP??GG?CJE@M@S@SFOCWDE?QEe@L_@LADE@@@E?CA?BCBE?A@@BSHI`@DJHJBDADE@E?UIUCYI@GBCIAe@?EGWOGCcA?AEE?GCGGEOOMEBMCGD?ZMJADRHTDRDLN?JEHG?@EEB@DJ@H?NBR@ND]CEBZDL??CDDE@BLLN@EB?DECHCB?FDFHN@AEKHGBO@FCJLAMD?PE@ADCRLNRDLJH?HF@DTLJHFJBLCLENIL?HGT?TDJD@HA@GFER_@BGCMBINOFCRHBAHIJCT@PAN@F@CD?FCBB@FAFBL?LKP@LCJ@PBPNRFHHDF?LAHCDF@LENEDGBMJKFKHMLGN?JNNEJEBIDIJIHEFG`@??Hv@?l@M\\IACX@T@BIJKHA@EJADCRABC@KRSN[?CHELQBOHICO?QDOGQCc@B[DODIAC]FIPEEBO","~_BoKGH??LFBBBC?CBGCE?CA?","n`B_L@BD?DEAAE@","vaBqLEF??F?BE","rbB{LABB@DCCA","`gBwd@O@AFJ@JALE","v~Agc@K@IDPHRFHEBIQE","bwAqj@?hA?pBS?SDMFOLSKSEKHKFQHa@b@a@L?JHHJGPEBQXOJQPA^?VEh@St@KZ@d@IVGTBCLJ@TBPDTBBIISUEDEXJLJZLMHPNTFRDDF\\HDHVFL?PBRFPD`@D@CUGQEUKWAIG[KCCOGAMKKVDDCJFJIDDFIRFJ?@KCEJGXBPIJC@KLGGKOIEIOAM@OGO?MEBGHCMGJ?TBDDLE\\BZEFGXK[Gk@IO?@Hi@?NKVGLIRGZGKIc@?WIEISGSAe@IQ@]K]DOFGCa@@@B_@BSAi@De@@O@YC]D","hjB{f@KBKAODS@@@LBNCFCP@BA"],"056":["{Bw^BLB?@JPIH@LIHGF?BEOCM?SCKH"]}} /* DATA_END */;

  var THEMES = {
    light: { bg: '#ffffff', text: '#1b1f24', muted: '#6b7280', accent: '#1f5fd6', land: '#e6e9ee', coast: '#cfd5de', sea: 'transparent', ring: '#ffffff' },
    dark:  { bg: '#0f1115', text: '#d5dae2', muted: '#8b93a1', accent: '#7cb3ff', land: '#242932', coast: '#343b47', sea: 'transparent', ring: '#0f1115' }
  };

  // ---- Equal Earth projection (Šavrič, Patterson & Jenny, 2018) ----
  var A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
  function project(lon, lat) {
    var l = lon * Math.PI / 180, p = lat * Math.PI / 180;
    var t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
    return [l * Math.cos(t) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
            t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
  }
  var XMAX = project(180, 0)[0], YMAX = project(0, 90)[1];

  function decodeRing(s) {
    var pts = [], i = 0, x = 0, y = 0;
    function num() { var r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); return (r & 1) ? ~(r >> 1) : (r >> 1); }
    while (i < s.length) { x += num(); y += num(); pts.push([x / 10, y / 10]); }
    return pts;
  }

  // ---- optional full-detail path: decode the vendored TopoJSON ----
  function fromTopo(topo) {
    var sx = topo.transform.scale[0], sy = topo.transform.scale[1], tx = topo.transform.translate[0], ty = topo.transform.translate[1];
    var arcs = topo.arcs.map(function (a) { var x = 0, y = 0; return a.map(function (d) { x += d[0]; y += d[1]; return [x * sx + tx, y * sy + ty]; }); });
    function ring(idx) { var pts = []; idx.forEach(function (i) { var a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; for (var k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]); }); return pts; }
    function rings(g) { var out = []; (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []).forEach(function (poly) {
      var r = ring(poly[0]); var top = -90; r.forEach(function (p) { if (p[1] > top) top = p[1]; }); if (top < -60) return; // Antarctica
      var pieces = [[]]; for (var i = 0; i < r.length; i++) { if (i && Math.abs(r[i][0] - r[i - 1][0]) > 180) pieces.push([]); pieces[pieces.length - 1].push(r[i]); }
      if (pieces.length > 1 && Math.abs(r[0][0] - r[r.length - 1][0]) <= 180) pieces[0] = pieces.pop().concat(pieces[0]);
      pieces.forEach(function (p) { if (p.length >= 3) out.push(p); }); }); return out; }
    var land = [], visited = {};
    topo.objects.land.geometries.forEach(function (g) { land = land.concat(rings(g)); });
    topo.objects.countries.geometries.forEach(function (g) { if (VISITED.indexOf(g.id) >= 0) visited[g.id] = rings(g); });
    return { land: land, visited: visited };
  }

  function pathFor(rings, W, H) {
    var d = '';
    for (var r = 0; r < rings.length; r++) {
      var pts = rings[r];
      for (var i = 0; i < pts.length; i++) {
        var p = project(pts[i][0], pts[i][1]);
        d += (i ? 'L' : 'M') + ((p[0] + XMAX) / (2 * XMAX) * W).toFixed(1) + ' ' + ((YMAX - p[1]) / (2 * YMAX) * H).toFixed(1);
      }
      d += 'Z';
    }
    return d;
  }
  function outline(W, H) {
    var d = '', n = 90;
    for (var i = 0; i <= n; i++) { var p = project(180, 90 - 180 * i / n); d += (i ? 'L' : 'M') + ((p[0] + XMAX) / (2 * XMAX) * W).toFixed(1) + ' ' + ((YMAX - p[1]) / (2 * YMAX) * H).toFixed(1); }
    for (i = 0; i <= n; i++) { p = project(-180, -90 + 180 * i / n); d += 'L' + ((p[0] + XMAX) / (2 * XMAX) * W).toFixed(1) + ' ' + ((YMAX - p[1]) / (2 * YMAX) * H).toFixed(1); }
    return d + 'Z';
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

  function mount(el, opts) {
    opts = opts || {};
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return null;
    var link = opts.link || BASE || './';
    var themeOpt = opts.theme || 'auto';
    var W = 440, H = Math.round(440 * YMAX / XMAX); // ~214
    var uid = 'pa' + Math.random().toString(36).slice(2, 8);

    el.innerHTML = '';
    var root = document.createElement('div');
    root.className = 'passport-atlas';
    root.setAttribute('role', 'figure');
    root.setAttribute('aria-label', 'World map of countries visited: ' + CAPTION);
    root.style.cssText = 'display:block;max-width:100%;font:13px/1.4 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--pa-text);box-sizing:border-box;';

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'display:block;width:100%;height:auto;max-height:220px;overflow:visible;';

    var sea = document.createElementNS(svgNS, 'path');
    sea.setAttribute('d', outline(W, H));
    sea.setAttribute('fill', 'var(--pa-sea)'); sea.setAttribute('stroke', 'var(--pa-coast)'); sea.setAttribute('stroke-width', '1');
    svg.appendChild(sea);

    var land = document.createElementNS(svgNS, 'path');
    land.setAttribute('fill', 'var(--pa-land)'); land.setAttribute('stroke', 'var(--pa-coast)'); land.setAttribute('stroke-width', '0.6'); land.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(land);

    var vis = document.createElementNS(svgNS, 'path');
    vis.setAttribute('fill', 'var(--pa-accent)'); vis.setAttribute('fill-opacity', '0.78'); vis.setAttribute('stroke', 'var(--pa-accent)'); vis.setAttribute('stroke-width', '0.8'); vis.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(vis);

    var home = document.createElementNS(svgNS, 'path');
    home.setAttribute('fill', 'var(--pa-accent)'); home.setAttribute('stroke', 'var(--pa-accent)'); home.setAttribute('stroke-width', '0.8'); home.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(home);

    // home pin: Garland, Texas
    var g = project(-96.64, 32.91), hx = (g[0] + XMAX) / (2 * XMAX) * W, hy = (YMAX - g[1]) / (2 * YMAX) * H;
    var pin = document.createElementNS(svgNS, 'circle');
    pin.setAttribute('cx', hx.toFixed(1)); pin.setAttribute('cy', hy.toFixed(1)); pin.setAttribute('r', '3.2');
    pin.setAttribute('fill', 'var(--pa-ring)'); pin.setAttribute('stroke', 'var(--pa-accent)'); pin.setAttribute('stroke-width', '1.6');
    svg.appendChild(pin);

    var cap = document.createElement('div');
    cap.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-top:6px;';
    var left = document.createElement('span');
    left.textContent = CAPTION;
    left.style.cssText = 'letter-spacing:0.02em;';
    var a = document.createElement('a');
    a.href = link; a.textContent = 'Passport Atlas →';
    a.style.cssText = 'color:var(--pa-accent);text-decoration:none;font-size:12px;white-space:nowrap;';
    cap.appendChild(left); cap.appendChild(a);
    root.appendChild(svg); root.appendChild(cap);
    el.appendChild(root);

    function applyTheme() {
      var t = THEMES[resolveTheme(themeOpt)];
      root.style.setProperty('--pa-text', t.text);
      root.style.setProperty('--pa-muted', t.muted);
      root.style.setProperty('--pa-accent', t.accent);
      root.style.setProperty('--pa-land', t.land);
      root.style.setProperty('--pa-coast', t.coast);
      root.style.setProperty('--pa-sea', t.sea);
      root.style.setProperty('--pa-ring', t.ring);
      root.setAttribute('data-pa-theme', resolveTheme(themeOpt));
    }
    applyTheme();
    var mo = null, mq = null;
    if (themeOpt === 'auto' && window.MutationObserver) {
      mo = new MutationObserver(applyTheme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      try { mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', applyTheme); } catch (e) { /* ignore */ }
    }

    function draw(data) {
      land.setAttribute('d', pathFor(data.land, W, H));
      var v = [], h = [];
      VISITED.forEach(function (id) { if (data.visited[id]) (id === HOME ? h : v).push.apply(id === HOME ? h : v, data.visited[id]); });
      vis.setAttribute('d', pathFor(v, W, H));
      home.setAttribute('d', pathFor(h, W, H));
    }
    var embedded = DATA ? { land: DATA.land.map(decodeRing), visited: {} } : null;
    if (embedded) for (var id in DATA.visited) embedded.visited[id] = DATA.visited[id].map(decodeRing);
    if (embedded) draw(embedded);
    if (opts.dataUrl && window.fetch) {
      fetch(opts.dataUrl).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (topo) { draw(fromTopo(topo)); })
        .catch(function () { /* keep the embedded coastline */ });
    }
    return { el: root, setTheme: function (t) { themeOpt = t || 'auto'; applyTheme(); }, destroy: function () { if (mo) mo.disconnect(); if (mq && mq.removeEventListener) mq.removeEventListener('change', applyTheme); root.remove(); } };
  }

  window.PassportAtlas = { mount: mount, visited: VISITED.slice(), caption: CAPTION };
})();
