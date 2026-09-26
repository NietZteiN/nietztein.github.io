// Songbook for Zipf Karaoke. Every text here is in the public domain worldwide:
// authors dead for well over 70 years and first publication before 1929.
// Where an editor's later reading is still under claim (Dickinson's Johnson/Franklin
// texts), the first published version is used instead.
// Fields: id, title, author, year (of first publication), kind, wpm (a comfortable
// default tempo for playback), text.
window.ZIPF_SONGBOOK = [
  {
    id: "jabberwocky",
    title: "Jabberwocky",
    author: "Lewis Carroll",
    year: 1871,
    kind: "poem",
    wpm: 150,
    text: `'Twas brillig, and the slithy toves
Did gyre and gimble in the wabe:
All mimsy were the borogoves,
And the mome raths outgrabe.

"Beware the Jabberwock, my son!
The jaws that bite, the claws that catch!
Beware the Jubjub bird, and shun
The frumious Bandersnatch!"

He took his vorpal sword in hand;
Long time the manxome foe he sought—
So rested he by the Tumtum tree
And stood awhile in thought.

And, as in uffish thought he stood,
The Jabberwock, with eyes of flame,
Came whiffling through the tulgey wood,
And burbled as it came!

One, two! One, two! And through and through
The vorpal blade went snicker-snack!
He left it dead, and with its head
He went galumphing back.

"And hast thou slain the Jabberwock?
Come to my arms, my beamish boy!
O frabjous day! Callooh! Callay!"
He chortled in his joy.

'Twas brillig, and the slithy toves
Did gyre and gimble in the wabe:
All mimsy were the borogoves,
And the mome raths outgrabe.`
  },
  {
    id: "tyger",
    title: "The Tyger",
    author: "William Blake",
    year: 1794,
    kind: "poem",
    wpm: 140,
    text: `Tyger Tyger, burning bright,
In the forests of the night;
What immortal hand or eye,
Could frame thy fearful symmetry?

In what distant deeps or skies
Burnt the fire of thine eyes?
On what wings dare he aspire?
What the hand, dare seize the fire?

And what shoulder, and what art,
Could twist the sinews of thy heart?
And when thy heart began to beat,
What dread hand? and what dread feet?

What the hammer? what the chain,
In what furnace was thy brain?
What the anvil? what dread grasp,
Dare its deadly terrors clasp!

When the stars threw down their spears
And water'd heaven with their tears:
Did he smile his work to see?
Did he who made the Lamb make thee?

Tyger Tyger burning bright,
In the forests of the night:
What immortal hand or eye,
Dare frame thy fearful symmetry?`
  },
  {
    id: "dickinson-death",
    title: "Because I could not stop for Death",
    author: "Emily Dickinson",
    year: 1890,
    kind: "poem",
    wpm: 130,
    text: `Because I could not stop for Death,
He kindly stopped for me;
The carriage held but just ourselves
And Immortality.

We slowly drove, he knew no haste,
And I had put away
My labor, and my leisure too,
For his civility.

We passed the school where children played,
Their lessons scarcely done;
We passed the fields of gazing grain,
We passed the setting sun.

We paused before a house that seemed
A swelling of the ground;
The roof was scarcely visible,
The cornice but a mound.

Since then 'tis centuries; but each
Feels shorter than the day
I first surmised the horses' heads
Were toward eternity.`
  },
  {
    id: "sonnet-18",
    title: "Sonnet 18",
    author: "William Shakespeare",
    year: 1609,
    kind: "poem",
    wpm: 140,
    text: `Shall I compare thee to a summer's day?
Thou art more lovely and more temperate:
Rough winds do shake the darling buds of May,
And summer's lease hath all too short a date;
Sometime too hot the eye of heaven shines,
And often is his gold complexion dimm'd;
And every fair from fair sometime declines,
By chance or nature's changing course untrimm'd;
But thy eternal summer shall not fade,
Nor lose possession of that fair thou ow'st;
Nor shall Death brag thou wander'st in his shade,
When in eternal lines to time thou grow'st:
So long as men can breathe or eyes can see,
So long lives this, and this gives life to thee.`
  },
  {
    id: "psalm-23",
    title: "Psalm 23",
    author: "King James Bible",
    year: 1611,
    kind: "psalm",
    wpm: 120,
    text: `The LORD is my shepherd; I shall not want.

He maketh me to lie down in green pastures: he leadeth me beside the still waters.

He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.

Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.

Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.

Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.`
  },
  {
    id: "amazing-grace",
    title: "Amazing Grace",
    author: "John Newton",
    year: 1779,
    kind: "hymn",
    wpm: 100,
    text: `Amazing grace! how sweet the sound,
That saved a wretch like me!
I once was lost, but now am found,
Was blind, but now I see.

'Twas grace that taught my heart to fear,
And grace my fears relieved;
How precious did that grace appear
The hour I first believed!

Through many dangers, toils, and snares,
I have already come;
'Tis grace hath brought me safe thus far,
And grace will lead me home.

The Lord has promised good to me,
His word my hope secures;
He will my shield and portion be,
As long as life endures.

Yes, when this flesh and heart shall fail,
And mortal life shall cease,
I shall possess, within the veil,
A life of joy and peace.

The earth shall soon dissolve like snow,
The sun forbear to shine;
But God, who called me here below,
Will be for ever mine.`
  },
  {
    id: "shenandoah",
    title: "Shenandoah",
    author: "Traditional",
    year: 1876,
    kind: "song",
    wpm: 90,
    text: `Oh Shenandoah, I long to see you,
Away, you rolling river.
Oh Shenandoah, I long to see you,
Away, I'm bound away, 'cross the wide Missouri.

Oh Shenandoah, I love your daughter,
Away, you rolling river.
For her I'd cross your roaming waters,
Away, I'm bound away, 'cross the wide Missouri.

'Tis seven years since last I saw you,
Away, you rolling river.
'Tis seven years since last I saw you,
Away, I'm bound away, 'cross the wide Missouri.

Oh Shenandoah, I'm bound to leave you,
Away, you rolling river.
Oh Shenandoah, I'll not deceive you,
Away, I'm bound away, 'cross the wide Missouri.`
  },
  {
    id: "scarborough-fair",
    title: "Scarborough Fair",
    author: "Traditional",
    year: 1891,
    kind: "song",
    wpm: 120,
    text: `Are you going to Scarborough Fair?
Parsley, sage, rosemary, and thyme;
Remember me to one who lives there,
For once she was a true love of mine.

Tell her to make me a cambric shirt,
Parsley, sage, rosemary, and thyme;
Without any seam or needlework,
Then she shall be a true love of mine.

Tell her to wash it in yonder well,
Parsley, sage, rosemary, and thyme;
Where never sprung water or rain ever fell,
And she shall be a true lover of mine.

Tell her to dry it on yonder thorn,
Parsley, sage, rosemary, and thyme;
Which never bore blossom since Adam was born,
Then she shall be a true lover of mine.

Now he has asked me questions three,
Parsley, sage, rosemary, and thyme;
I hope he'll answer as many for me,
Before he shall be a true lover of mine.

Tell him to buy me an acre of land,
Parsley, sage, rosemary, and thyme;
Betwixt the salt water and the sea sand,
Then he shall be a true lover of mine.

Tell him to plough it with a ram's horn,
Parsley, sage, rosemary, and thyme;
And sow it all over with one pepper corn,
And he shall be a true lover of mine.

Tell him to thrash it on yonder wall,
Parsley, sage, rosemary, and thyme,
And never let one corn of it fall,
Then he shall be a true lover of mine.

When he has done and finished his work,
Parsley, sage, rosemary, and thyme:
Oh, tell him to come and he'll have his shirt,
And he shall be a true lover of mine.`
  },
  {
    id: "song-of-myself-1",
    title: "Song of Myself, 1",
    author: "Walt Whitman",
    year: 1892,
    kind: "poem",
    wpm: 140,
    text: `I celebrate myself, and sing myself,
And what I assume you shall assume,
For every atom belonging to me as good belongs to you.

I loafe and invite my soul,
I lean and loafe at my ease observing a spear of summer grass.

My tongue, every atom of my blood, form'd from this soil, this air,
Born here of parents born here from parents the same, and their parents the same,
I, now thirty-seven years old in perfect health begin,
Hoping to cease not till death.

Creeds and schools in abeyance,
Retiring back a while sufficed at what they are, but never forgotten,
I harbor for good or bad, I permit to speak at every hazard,
Nature without check with original energy.`
  },
  {
    id: "second-coming",
    title: "The Second Coming",
    author: "W. B. Yeats",
    year: 1920,
    kind: "poem",
    wpm: 130,
    text: `Turning and turning in the widening gyre
The falcon cannot hear the falconer;
Things fall apart; the centre cannot hold;
Mere anarchy is loosed upon the world,
The blood-dimmed tide is loosed, and everywhere
The ceremony of innocence is drowned;
The best lack all conviction, while the worst
Are full of passionate intensity.

Surely some revelation is at hand;
Surely the Second Coming is at hand.
The Second Coming! Hardly are those words out
When a vast image out of Spiritus Mundi
Troubles my sight: somewhere in sands of the desert
A shape with lion body and the head of a man,
A gaze blank and pitiless as the sun,
Is moving its slow thighs, while all about it
Reel shadows of the indignant desert birds.
The darkness drops again; but now I know
That twenty centuries of stony sleep
Were vexed to nightmare by a rocking cradle,
And what rough beast, its hour come round at last,
Slouches towards Bethlehem to be born?`
  },
  {
    id: "ozymandias",
    title: "Ozymandias",
    author: "Percy Bysshe Shelley",
    year: 1818,
    kind: "poem",
    wpm: 140,
    text: `I met a traveller from an antique land,
Who said—"Two vast and trunkless legs of stone
Stand in the desert. Near them, on the sand,
Half sunk a shattered visage lies, whose frown,
And wrinkled lip, and sneer of cold command,
Tell that its sculptor well those passions read
Which yet survive, stamped on these lifeless things,
The hand that mocked them, and the heart that fed;
And on the pedestal, these words appear:
My name is Ozymandias, King of Kings;
Look on my Works, ye Mighty, and despair!
Nothing beside remains. Round the decay
Of that colossal Wreck, boundless and bare
The lone and level sands stretch far away."`
  },
  {
    id: "pied-beauty",
    title: "Pied Beauty",
    author: "Gerard Manley Hopkins",
    year: 1918,
    kind: "poem",
    wpm: 120,
    text: `Glory be to God for dappled things—
For skies of couple-colour as a brinded cow;
For rose-moles all in stipple upon trout that swim;
Fresh-firecoal chestnut-falls; finches' wings;
Landscape plotted and pieced—fold, fallow, and plough;
And all trades, their gear and tackle and trim.

All things counter, original, spare, strange;
Whatever is fickle, freckled (who knows how?)
With swift, slow; sweet, sour; adazzle, dim;
He fathers-forth whose beauty is past change:
Praise him.`
  },
  {
    id: "owl-pussycat",
    title: "The Owl and the Pussy-Cat",
    author: "Edward Lear",
    year: 1871,
    kind: "poem",
    wpm: 160,
    text: `The Owl and the Pussy-Cat went to sea
In a beautiful pea-green boat,
They took some honey, and plenty of money,
Wrapped up in a five-pound note.
The Owl looked up to the stars above,
And sang to a small guitar,
"O lovely Pussy! O Pussy, my love,
What a beautiful Pussy you are,
You are,
You are!
What a beautiful Pussy you are!"

Pussy said to the Owl, "You elegant fowl!
How charmingly sweet you sing!
O let us be married! too long we have tarried:
But what shall we do for a ring?"
They sailed away, for a year and a day,
To the land where the Bong-Tree grows
And there in a wood a Piggy-wig stood
With a ring at the end of his nose,
His nose,
His nose,
With a ring at the end of his nose.

"Dear Pig, are you willing to sell for one shilling
Your ring?" Said the Piggy, "I will."
So they took it away, and were married next day
By the Turkey who lives on the hill.
They dined on mince, and slices of quince,
Which they ate with a runcible spoon;
And hand in hand, on the edge of the sand,
They danced by the light of the moon,
The moon,
The moon,
They danced by the light of the moon.`
  },
  {
    id: "loveliest-of-trees",
    title: "Loveliest of trees",
    author: "A. E. Housman",
    year: 1896,
    kind: "poem",
    wpm: 130,
    text: `Loveliest of trees, the cherry now
Is hung with bloom along the bough,
And stands about the woodland ride
Wearing white for Eastertide.

Now, of my threescore years and ten,
Twenty will not come again,
And take from seventy springs a score,
It only leaves me fifty more.

And since to look at things in bloom
Fifty springs are little room,
About the woodlands I will go
To see the cherry hung with snow.`
  }
];
