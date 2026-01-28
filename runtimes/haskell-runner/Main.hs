module Main where

import Control.Applicative ((<|>))
import Data.Char (isAlpha, isAlphaNum, isDigit, isSpace)
import Data.List (sortOn)
import Numeric (readHex)
import System.IO (hFlush, stdout)
import Text.ParserCombinators.ReadP

data JValue
  = JNull
  | JBool Bool
  | JNumber Double
  | JString String
  | JArray [JValue]
  | JObject [(String, JValue)]
  deriving (Eq, Show)

data Request = Request
  { reqMode :: String
  , reqCode :: String
  , reqInput :: JValue
  }

data Expr
  = ELit JValue
  | EVar String
  | EList [Expr]
  | EIf Expr Expr Expr
  | EBin Op Expr Expr
  | EApp Expr Expr
  deriving (Eq, Show)

data Op
  = Add
  | Sub
  | Mul
  | Div
  | Mod
  | Eq
  | Neq
  | Lt
  | Lte
  | Gt
  | Gte
  | And
  | Or
  | Concat
  | Index
  deriving (Eq, Show)

main :: IO ()
main = do
  input <- getContents
  case parseJson input of
    Left err -> emitError $ "Invalid input JSON: " ++ err
    Right value ->
      case parseRequest value of
        Left err -> emitError err
        Right req -> runRequest req

runRequest :: Request -> IO ()
runRequest req = do
  case reqMode req of
    "executor" -> runExpr
    "test" -> runExpr
    other -> emitError $ "Unsupported mode: " ++ other
  where
    runExpr = do
      let exprText = extractExpression (reqCode req)
      case parseExpr exprText of
        Left err -> emitError $ "Failed to parse code: " ++ err
        Right expr ->
          case evalExpr (reqInput req) expr of
            Left err -> emitError err
            Right result -> emitResult "" result

emitResult :: String -> JValue -> IO ()
emitResult logs result = do
  putStrLn $ encodeJson $ JObject [("logs", JString logs), ("result", result)]
  hFlush stdout

emitError :: String -> IO ()
emitError msg = emitResult msg JNull

parseRequest :: JValue -> Either String Request
parseRequest (JObject fields) = do
  mode <- lookupString "mode" fields
  code <- lookupString "code" fields
  let input = lookupField "input" fields
  pure $ Request mode code (maybe JNull id input)
parseRequest _ = Left "Request payload must be a JSON object"

lookupField :: String -> [(String, JValue)] -> Maybe JValue
lookupField key = lookup key

lookupString :: String -> [(String, JValue)] -> Either String String
lookupString key fields =
  case lookup key fields of
    Just (JString s) -> Right s
    _ -> Left $ "Missing or invalid field: " ++ key

-- Extract a single expression from Haskell-like code
extractExpression :: String -> String
extractExpression code =
  let cleanedLines = map stripLineComment $ filter (not . isTypeSignature) $ lines code
      (maybeLine, rest) = findSolutionLine cleanedLines
   in case maybeLine of
        Just line ->
          let afterEq = drop 1 $ dropWhile (/= '=') line
              indented = takeWhile isIndented rest
           in unwords $ filter (not . null) (trim afterEq : map trim indented)
        Nothing -> trim (unwords cleanedLines)

isTypeSignature :: String -> Bool
isTypeSignature line = "::" `isInfix` line

isInfix :: String -> String -> Bool
isInfix needle hay = any (needle `prefixOf`) (tails hay)

prefixOf :: String -> String -> Bool
prefixOf [] _ = True
prefixOf _ [] = False
prefixOf (a:as) (b:bs) = a == b && prefixOf as bs

tails :: String -> [String]
tails [] = []
tails xs@(_:rest) = xs : tails rest

findSolutionLine :: [String] -> (Maybe String, [String])
findSolutionLine [] = (Nothing, [])
findSolutionLine (l:ls)
  | "solution" `isInfix` l && '=' `elem` l = (Just l, ls)
  | otherwise = findSolutionLine ls

isIndented :: String -> Bool
isIndented line = case line of
  (' ':_) -> True
  ('\t':_) -> True
  _ -> False

stripLineComment :: String -> String
stripLineComment [] = []
stripLineComment ('-':'-':_) = []
stripLineComment (c:cs) = c : stripLineComment cs

trim :: String -> String
trim = rtrim . ltrim

ltrim :: String -> String
ltrim = dropWhile isSpace

rtrim :: String -> String
rtrim = reverse . dropWhile isSpace . reverse

-- JSON parsing
parseJson :: String -> Either String JValue
parseJson input =
  case [v | (v, rest) <- readP_to_S (skipSpaces *> jsonValue <* skipSpaces <* eof) input, all isSpace rest] of
    (v:_) -> Right v
    [] -> Left "parse error"

jsonValue :: ReadP JValue
jsonValue =
  jsonNull
    <|> jsonBool
    <|> jsonNumber
    <|> jsonString
    <|> jsonArray
    <|> jsonObject

jsonNull :: ReadP JValue
jsonNull = string "null" >> pure JNull

jsonBool :: ReadP JValue
jsonBool = (string "true" >> pure (JBool True)) <|> (string "false" >> pure (JBool False))

jsonNumber :: ReadP JValue
jsonNumber = do
  sign <- option "" (string "-")
  intPart <- munch1 isDigit
  fracPart <- option "" (char '.' *> munch1 isDigit >>= \d -> pure ('.' : d))
  expPart <- option "" $ do
    e <- char 'e' <|> char 'E'
    signExp <- option "" (string "+" <|> string "-")
    digits <- munch1 isDigit
    pure (e : signExp ++ digits)
  let numStr = sign ++ intPart ++ fracPart ++ expPart
  pure $ JNumber (read numStr)

jsonString :: ReadP JValue
jsonString = JString <$> (char '"' *> many jsonChar <* char '"')

jsonChar :: ReadP Char
jsonChar =
  satisfy (\c -> c /= '"' && c /= '\\' && c >= ' ')
    <|> (char '\\' *> escapeChar)

escapeChar :: ReadP Char
escapeChar =
  (char '"' >> pure '"')
    <|> (char '\\' >> pure '\\')
    <|> (char '/' >> pure '/')
    <|> (char 'b' >> pure '\b')
    <|> (char 'f' >> pure '\f')
    <|> (char 'n' >> pure '\n')
    <|> (char 'r' >> pure '\r')
    <|> (char 't' >> pure '\t')
    <|> (char 'u' >> unicodeChar)

unicodeChar :: ReadP Char
unicodeChar = do
  a <- hexDigit
  b <- hexDigit
  c <- hexDigit
  d <- hexDigit
  let code = fst $ head (readHex [a, b, c, d])
  pure (toEnum code)

hexDigit :: ReadP Char
hexDigit = satisfy (\c -> isDigit c || c `elem` ("abcdef" :: String) || c `elem` ("ABCDEF" :: String))

jsonArray :: ReadP JValue
jsonArray = JArray <$> between (symbol "[") (symbol "]") (sepBy jsonValue (symbol ","))

jsonObject :: ReadP JValue
jsonObject = JObject <$> between (symbol "{") (symbol "}") (sepBy jsonPair (symbol ","))

jsonPair :: ReadP (String, JValue)
jsonPair = do
  JString key <- jsonString
  _ <- symbol ":"
  val <- jsonValue
  pure (key, val)

-- JSON encoding
encodeJson :: JValue -> String
encodeJson JNull = "null"
encodeJson (JBool True) = "true"
encodeJson (JBool False) = "false"
encodeJson (JNumber n) = renderNumber n
encodeJson (JString s) = '"' : escapeString s ++ "\""
encodeJson (JArray xs) = "[" ++ joinWith "," (map encodeJson xs) ++ "]"
encodeJson (JObject xs) =
  let sorted = sortOn fst xs
      pairs = [encodeJson (JString k) ++ ":" ++ encodeJson v | (k, v) <- sorted]
   in "{" ++ joinWith "," pairs ++ "}"

escapeString :: String -> String
escapeString = concatMap escapeCharOut

escapeCharOut :: Char -> String
escapeCharOut '"' = "\\\""
escapeCharOut '\\' = "\\\\"
escapeCharOut '\n' = "\\n"
escapeCharOut '\r' = "\\r"
escapeCharOut '\t' = "\\t"
escapeCharOut c
  | c < ' ' = "\\u" ++ pad4 (showHex (fromEnum c))
  | otherwise = [c]

showHex :: Int -> String
showHex n =
  let digits = "0123456789abcdef"
      go 0 acc = acc
      go x acc =
        let (q, r) = x `divMod` 16
         in go q (digits !! r : acc)
   in if n == 0 then "0" else go n ""

pad4 :: String -> String
pad4 s = replicate (4 - length s) '0' ++ s

renderNumber :: Double -> String
renderNumber n =
  let rounded = fromInteger (round n)
   in if abs (n - rounded) < 1e-9
        then show (round n :: Integer)
        else show n

joinWith :: String -> [String] -> String
joinWith _ [] = ""
joinWith _ [x] = x
joinWith sep (x:xs) = x ++ sep ++ joinWith sep xs

symbol :: String -> ReadP String
symbol s = skipSpaces *> string s <* skipSpaces

-- Expression parsing
parseExpr :: String -> Either String Expr
parseExpr input =
  case [v | (v, rest) <- readP_to_S (skipSpaces *> expr <* skipSpaces <* eof) input, all isSpace rest] of
    (v:_) -> Right v
    [] -> Left "parse error"

expr :: ReadP Expr
expr = parseIf <|> parseOr

parseIf :: ReadP Expr
parseIf =
  (do
      _ <- symbol "if"
      cond <- expr
      _ <- symbol "then"
      tBranch <- expr
      _ <- symbol "else"
      fBranch <- expr
      pure (EIf cond tBranch fBranch)
    )

parseOr :: ReadP Expr
parseOr = chainl1 parseAnd (symbol "||" >> pure (EBin Or))

parseAnd :: ReadP Expr
parseAnd = chainl1 parseEq (symbol "&&" >> pure (EBin And))

parseEq :: ReadP Expr
parseEq = chainl1 parseCmp (eqOp <|> neqOp)
  where
    eqOp = symbol "==" >> pure (EBin Eq)
    neqOp = symbol "/=" >> pure (EBin Neq)

parseCmp :: ReadP Expr
parseCmp = chainl1 parseConcat (ltOp <|> lteOp <|> gtOp <|> gteOp)
  where
    ltOp = symbol "<" >> pure (EBin Lt)
    lteOp = symbol "<=" >> pure (EBin Lte)
    gtOp = symbol ">" >> pure (EBin Gt)
    gteOp = symbol ">=" >> pure (EBin Gte)

parseConcat :: ReadP Expr
parseConcat = chainl1 parseAdd (symbol "++" >> pure (EBin Concat))

parseAdd :: ReadP Expr
parseAdd = chainl1 parseMul (addOp <|> subOp)
  where
    addOp = symbol "+" >> pure (EBin Add)
    subOp = symbol "-" >> pure (EBin Sub)

parseMul :: ReadP Expr
parseMul = chainl1 parseIndex (mulOp <|> divOp <|> modOp)
  where
    mulOp = symbol "*" >> pure (EBin Mul)
    divOp = symbol "/" >> pure (EBin Div)
    modOp = symbol "mod" >> pure (EBin Mod)

parseIndex :: ReadP Expr
parseIndex = chainl1 parseApp (symbol "!!" >> pure (EBin Index))

parseApp :: ReadP Expr
parseApp = do
  terms <- many1 parseAtom
  pure (foldl1 EApp terms)

parseAtom :: ReadP Expr
parseAtom =
  parseList
    <|> parseLiteral
    <|> parseVar
    <|> between (symbol "(") (symbol ")") expr

parseList :: ReadP Expr
parseList = EList <$> between (symbol "[") (symbol "]") (sepBy expr (symbol ","))

parseLiteral :: ReadP Expr
parseLiteral =
  (ELit <$> (jsonNull <|> jsonBool <|> jsonNumber <|> jsonString))

parseVar :: ReadP Expr
parseVar = do
  ident <- lexeme identifier
  pure (EVar ident)

identifier :: ReadP String
identifier = do
  first <- satisfy (\c -> isAlpha c || c == '_')
  rest <- munch (\c -> isAlphaNum c || c == '_')
  pure (first : rest)

lexeme :: ReadP a -> ReadP a
lexeme p = skipSpaces *> p <* skipSpaces

many1 :: ReadP a -> ReadP [a]
many1 p = (:) <$> p <*> many p

-- Evaluation
evalExpr :: JValue -> Expr -> Either String JValue
evalExpr inputVal expr0 = eval expr0
  where
    eval (ELit v) = Right v
    eval (EVar name)
      | name == "input" = Right inputVal
      | name == "null" = Right JNull
      | name == "True" = Right (JBool True)
      | name == "False" = Right (JBool False)
      | otherwise = Left $ "Unknown variable: " ++ name
    eval (EList xs) = JArray <$> mapM eval xs
    eval (EIf cond tBranch fBranch) = do
      c <- eval cond
      case c of
        JBool True -> eval tBranch
        JBool False -> eval fBranch
        _ -> Left "if condition must be boolean"
    eval (EBin op a b) = do
      va <- eval a
      vb <- eval b
      evalBin op va vb
    eval app@(EApp _ _) =
      let (fn, args) = flattenApp app
       in case fn of
            EVar name -> applyBuiltin name inputVal =<< mapM eval args
            _ -> Left "Only builtin function calls are supported"

flattenApp :: Expr -> (Expr, [Expr])
flattenApp (EApp f x) =
  let (fn, args) = flattenApp f
   in (fn, args ++ [x])
flattenApp other = (other, [])

applyBuiltin :: String -> JValue -> [JValue] -> Either String JValue
applyBuiltin name _ args =
  case (name, args) of
    ("length", [JArray xs]) -> Right (JNumber (fromIntegral (length xs)))
    ("length", [JString s]) -> Right (JNumber (fromIntegral (length s)))
    ("sum", [JArray xs]) -> JNumber <$> foldNum xs sum
    ("product", [JArray xs]) -> JNumber <$> foldNum xs product
    ("reverse", [JArray xs]) -> Right (JArray (reverse xs))
    ("reverse", [JString s]) -> Right (JString (reverse s))
    ("head", [JArray (x:_)] ) -> Right x
    ("tail", [JArray (_:xs)] ) -> Right (JArray xs)
    ("maximum", [JArray xs]) -> JNumber <$> foldNum xs maximum
    ("minimum", [JArray xs]) -> JNumber <$> foldNum xs minimum
    ("abs", [JNumber n]) -> Right (JNumber (abs n))
    ("not", [JBool b]) -> Right (JBool (not b))
    ("sort", [JArray xs]) -> Right (JArray (sortOn normalize xs))
    _ -> Left $ "Unsupported function call: " ++ name

foldNum :: [JValue] -> ([Double] -> Double) -> Either String Double
foldNum xs f = do
  nums <- mapM expectNumber xs
  pure (f nums)

expectNumber :: JValue -> Either String Double
expectNumber (JNumber n) = Right n
expectNumber _ = Left "Expected number"

normalize :: JValue -> String
normalize = encodeJson

evalBin :: Op -> JValue -> JValue -> Either String JValue
evalBin Add (JNumber a) (JNumber b) = Right (JNumber (a + b))
evalBin Sub (JNumber a) (JNumber b) = Right (JNumber (a - b))
evalBin Mul (JNumber a) (JNumber b) = Right (JNumber (a * b))
evalBin Div (JNumber _) (JNumber 0) = Left "Division by zero"
evalBin Div (JNumber a) (JNumber b) = Right (JNumber (a / b))
evalBin Mod (JNumber _) (JNumber 0) = Left "Modulo by zero"
evalBin Mod (JNumber a) (JNumber b) = Right (JNumber (fromIntegral (floor a `mod` floor b)))
evalBin Eq a b = Right (JBool (a == b))
evalBin Neq a b = Right (JBool (a /= b))
evalBin Lt (JNumber a) (JNumber b) = Right (JBool (a < b))
evalBin Lt (JString a) (JString b) = Right (JBool (a < b))
evalBin Lte (JNumber a) (JNumber b) = Right (JBool (a <= b))
evalBin Lte (JString a) (JString b) = Right (JBool (a <= b))
evalBin Gt (JNumber a) (JNumber b) = Right (JBool (a > b))
evalBin Gt (JString a) (JString b) = Right (JBool (a > b))
evalBin Gte (JNumber a) (JNumber b) = Right (JBool (a >= b))
evalBin Gte (JString a) (JString b) = Right (JBool (a >= b))
evalBin And (JBool a) (JBool b) = Right (JBool (a && b))
evalBin Or (JBool a) (JBool b) = Right (JBool (a || b))
evalBin Concat (JArray a) (JArray b) = Right (JArray (a ++ b))
evalBin Concat (JString a) (JString b) = Right (JString (a ++ b))
evalBin Index (JArray xs) (JNumber n) =
  let idx = floor n
      isInt = abs (n - fromInteger (round n)) < 1e-9
   in if not isInt
        then Left "Index must be an integer"
        else if idx < 0 || idx >= length xs
          then Left "Index out of bounds"
          else Right (xs !! idx)
evalBin _ _ _ = Left "Unsupported operation"
